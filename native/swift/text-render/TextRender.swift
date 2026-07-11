// native/swift/text-render/TextRender.swift
//
// Headless CoreText + CoreGraphics renderer for Spectra's polish-pipeline
// overlays: caption banners, numbered step chips, and (legacy) frame-chrome
// background/mask PNGs. Replaces the python3/Pillow tier that used to be
// the preferred renderer in src/pipeline/text-render.ts -- this binary runs
// with no window server / display attachment required: every draw happens
// into an off-screen CGBitmapContext, and output is written straight to a
// PNG file via ImageIO.
//
// Invocation contract (mirrors the old python3 tier so text-render.ts's
// call sites barely change):
//   spectra-text-render --probe        -> exit 0 if the renderer can load
//                                          its font; no stdin/stdout I/O.
//   spectra-text-render                -> reads one JSON request object from
//                                          stdin, renders it, writes the PNG
//                                          named by the request's `outPath`.
//                                          Exit 0 on success; non-zero + a
//                                          message on stderr on failure.
//
// Request shape (kept in lockstep with RenderRequest in text-render.ts):
//   kind: "step-card" | "caption" | "title-card" | "frame-background" | "frame-mask"
//   outPath, outW, outH, fontSize?, fontPath?, fontIndex?
//   step-card: x, y, stepText, stepLabel?, style
//   caption: text, style
//   title-card: text (full-frame gradient card, large centered typography)
//   frame-background / frame-mask: contentW, contentH, contentX, contentY, cornerRadius
//   style (step-card/caption only): bannerBackground {r,g,b}, bannerBackgroundAlpha,
//     bannerHeightRatio, chipColor {r,g,b}, chipScale
//
// Geometry/color constants below are the CAPTION_BANNER_SPEC values from
// src/pipeline/text-render.ts -- used as fallbacks when a field is absent
// from `style` (frame-background/frame-mask requests don't carry a style at
// all, and are unaffected by the fallbacks below since they don't reference
// them).

import CoreGraphics
import CoreImage
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - Canonical spec fallbacks (mirrors CAPTION_BANNER_SPEC in TS)

let specBannerHeightRatio: Double = 0.12
let specBannerBackground: (Int, Int, Int) = (5, 7, 9)
let specBannerBackgroundAlpha: Double = 0.92
let specChipSideRatio: Double = 0.06
let specChipCornerRadiusRatio: Double = 0.2
let specChipColor: (Int, Int, Int) = (39, 175, 232)
let specChipInsetXRatio: Double = 0.0325
let specCaptionTextColor: (Int, Int, Int) = (248, 250, 252)
let specCaptionGapRatio: Double = 0.015

let defaultFontPath = "/System/Library/Fonts/Helvetica.ttc"
let defaultFontIndex = 1

// MARK: - Errors

enum RenderError: Error, CustomStringConvertible {
    case fontLoadFailed(String, Int)
    case invalidJSON
    case missingField(String)
    case writeFailed(String)
    case unknownKind(String)
    case contextCreationFailed

    var description: String {
        switch self {
        case .fontLoadFailed(let path, let index):
            return "failed to load font at \(path) (face index \(index))"
        case .invalidJSON:
            return "invalid JSON request on stdin"
        case .missingField(let name):
            return "request missing required field: \(name)"
        case .writeFailed(let path):
            return "failed to write PNG to \(path)"
        case .unknownKind(let kind):
            return "unknown render kind: \(kind)"
        case .contextCreationFailed:
            return "failed to create bitmap context"
        }
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

// MARK: - JSON helpers

typealias JSONDict = [String: Any]

func asDict(_ any: Any?) -> JSONDict? { any as? JSONDict }
func asString(_ any: Any?) -> String? { any as? String }
func asInt(_ any: Any?) -> Int? {
    if let n = any as? NSNumber { return n.intValue }
    return nil
}
func asDouble(_ any: Any?) -> Double? {
    if let n = any as? NSNumber { return n.doubleValue }
    return nil
}

func requireInt(_ dict: JSONDict, _ key: String) throws -> Int {
    guard let value = asInt(dict[key]) else { throw RenderError.missingField(key) }
    return value
}

func requireString(_ dict: JSONDict, _ key: String) throws -> String {
    guard let value = asString(dict[key]) else { throw RenderError.missingField(key) }
    return value
}

func rgb(_ dict: JSONDict?, fallback: (Int, Int, Int)) -> (Int, Int, Int) {
    guard let dict, let r = asInt(dict["r"]), let g = asInt(dict["g"]), let b = asInt(dict["b"]) else {
        return fallback
    }
    return (r, g, b)
}

// MARK: - Style

struct BannerStyle {
    let bannerBackground: (Int, Int, Int)
    let bannerBackgroundAlpha: Double
    let bannerHeightRatio: Double
    let chipColor: (Int, Int, Int)
    let chipScale: Double

    static func resolve(_ any: Any?) -> BannerStyle {
        let dict = asDict(any)
        return BannerStyle(
            bannerBackground: rgb(asDict(dict?["bannerBackground"]), fallback: specBannerBackground),
            bannerBackgroundAlpha: asDouble(dict?["bannerBackgroundAlpha"]) ?? specBannerBackgroundAlpha,
            bannerHeightRatio: asDouble(dict?["bannerHeightRatio"]) ?? specBannerHeightRatio,
            chipColor: rgb(asDict(dict?["chipColor"]), fallback: specChipColor),
            chipScale: asDouble(dict?["chipScale"]) ?? 1.0
        )
    }
}

// MARK: - Font loading + text measurement

func loadFont(path: String, size: Double, index: Int) throws -> CTFont {
    let url = URL(fileURLWithPath: path)
    guard
        let cfArray = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL),
        let descriptors = cfArray as? [CTFontDescriptor],
        descriptors.indices.contains(index)
    else {
        throw RenderError.fontLoadFailed(path, index)
    }
    return CTFontCreateWithFontDescriptor(descriptors[index], CGFloat(size), nil)
}

struct LineMetrics {
    let line: CTLine
    let width: CGFloat
    let ascent: CGFloat
    let descent: CGFloat
}

/// Builds a CTLine via CFAttributedString (rather than NSAttributedString) so
/// this binary never needs to link AppKit -- CoreText's kCTFontAttributeName
/// / kCTForegroundColorAttributeName CFString keys are enough on their own.
func measureLine(_ text: String, font: CTFont, color: CGColor) -> LineMetrics {
    let renderedText = text.isEmpty ? " " : text
    let attributed = CFAttributedStringCreateMutable(kCFAllocatorDefault, 0)!
    CFAttributedStringReplaceString(attributed, CFRangeMake(0, 0), renderedText as CFString)
    let fullRange = CFRangeMake(0, CFAttributedStringGetLength(attributed))
    CFAttributedStringSetAttribute(attributed, fullRange, kCTFontAttributeName, font)
    CFAttributedStringSetAttribute(attributed, fullRange, kCTForegroundColorAttributeName, color)
    let line = CTLineCreateWithAttributedString(attributed)
    var ascent: CGFloat = 0
    var descent: CGFloat = 0
    var leading: CGFloat = 0
    let width = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
    return LineMetrics(line: line, width: width, ascent: ascent, descent: descent)
}

/// Mirrors fit_font() in the retired Pillow script: shrink the font size by 2pt
/// steps until the line's advance width fits maxWidth, floored at minSize.
func fitFont(
    text: String,
    path: String,
    index: Int,
    startSize: Double,
    maxWidth: CGFloat,
    minSize: Double,
    color: CGColor
) throws -> (font: CTFont, metrics: LineMetrics) {
    var size = startSize
    while size > minSize {
        let font = try loadFont(path: path, size: size, index: index)
        let metrics = measureLine(text, font: font, color: color)
        if metrics.width <= maxWidth {
            return (font, metrics)
        }
        size -= 2
    }
    let finalSize = max(minSize, size)
    let font = try loadFont(path: path, size: finalSize, index: index)
    let metrics = measureLine(text, font: font, color: color)
    return (font, metrics)
}

/// Draws `metrics.line` left-anchored at `x`, vertically centered on
/// `centerYTopDown` (measured from the top of the image, y grows downward --
/// matching the ratio math shared with the ratio math in text-render.ts).
/// CoreGraphics/CoreText both use a bottom-left origin (y grows upward), so
/// this is the one place top-down coordinates get flipped into CG's frame.
func drawCenteredLine(_ context: CGContext, metrics: LineMetrics, x: CGFloat, centerYTopDown: CGFloat, outH: Int) {
    let baselineTopDown = centerYTopDown + (metrics.ascent - metrics.descent) / 2
    let baselineCG = CGFloat(outH) - baselineTopDown
    context.textPosition = CGPoint(x: x, y: baselineCG)
    CTLineDraw(metrics.line, context)
}

// MARK: - Geometry helpers

/// Converts a top-down rect (x, topY, width, height) to CoreGraphics'
/// bottom-left-origin rect.
func cgRect(x: CGFloat, topY: CGFloat, width: CGFloat, height: CGFloat, outH: Int) -> CGRect {
    CGRect(x: x, y: CGFloat(outH) - (topY + height), width: width, height: height)
}

// CGColor(red:green:blue:alpha:) and CGColorSpaceCreateDeviceRGB() both
// resolve to CoreGraphics' legacy "Device RGB" space, which is NOT
// numerically equal to sRGB (verified empirically: a (39,175,232) fill
// round-tripped through PNG came back as (41,189,237) with DeviceRGB, and
// exactly (39,175,232) with an explicit sRGB space). CAPTION_BANNER_SPEC's
// r/g/b values are plain sRGB byte values, so every RGB context and color in
// this file must use this explicit sRGB space to match text-render.ts's
// (and the retired Pillow renderer's) color output byte-for-byte.
let rgbColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

func cgColor(_ rgbTuple: (Int, Int, Int), alpha: Double = 1.0) -> CGColor {
    CGColor(
        colorSpace: rgbColorSpace,
        components: [CGFloat(rgbTuple.0) / 255.0, CGFloat(rgbTuple.1) / 255.0, CGFloat(rgbTuple.2) / 255.0, CGFloat(alpha)]
    )!
}

// MARK: - Bitmap contexts

func makeRGBAContext(width: Int, height: Int) throws -> CGContext {
    let colorSpace = rgbColorSpace
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw RenderError.contextCreationFailed
    }
    return context
}

func makeGrayContext(width: Int, height: Int) throws -> CGContext {
    let colorSpace = CGColorSpaceCreateDeviceGray()
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
        throw RenderError.contextCreationFailed
    }
    return context
}

func writePNG(_ image: CGImage, to path: String) throws {
    let url = URL(fileURLWithPath: path)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw RenderError.writeFailed(path)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw RenderError.writeFailed(path)
    }
}

// MARK: - step-card / caption shared banner drawing

/// Draws the bottom-anchored, full-width caption banner (background fill
/// only) and returns (bannerH, bannerY, centerY) in top-down coordinates --
/// mirrors render_step_card / render_caption's shared banner setup.
func drawBanner(_ context: CGContext, outW: Int, outH: Int, style: BannerStyle) -> (bannerH: CGFloat, bannerY: CGFloat, centerY: CGFloat) {
    let bannerH = max(1, (Double(outH) * style.bannerHeightRatio).rounded())
    let bannerY = Double(outH) - bannerH
    let rect = cgRect(x: 0, topY: CGFloat(bannerY), width: CGFloat(outW), height: CGFloat(bannerH), outH: outH)
    context.setFillColor(cgColor(style.bannerBackground, alpha: style.bannerBackgroundAlpha))
    context.fill(rect)
    let centerY = bannerY + bannerH / 2
    return (CGFloat(bannerH), CGFloat(bannerY), CGFloat(centerY))
}

func renderStepCard(_ request: JSONDict) throws -> CGImage {
    let outW = try requireInt(request, "outW")
    let outH = try requireInt(request, "outH")
    let fontPath = asString(request["fontPath"]) ?? defaultFontPath
    let fontIndex = asInt(request["fontIndex"]) ?? defaultFontIndex
    let fontSize = asDouble(request["fontSize"]) ?? 40
    let stepText = try requireString(request, "stepText")
    let stepLabel = asString(request["stepLabel"])
    let style = BannerStyle.resolve(request["style"])

    let context = try makeRGBAContext(width: outW, height: outH)
    let (bannerH, bannerY, centerY) = drawBanner(context, outW: outW, outH: outH, style: style)

    let chipInsetX = (Double(outW) * specChipInsetXRatio).rounded()
    var textStartX = CGFloat(chipInsetX)

    let captionColor = cgColor(specCaptionTextColor)

    if let label = stepLabel, !label.isEmpty {
        let chipSide = max(1, (Double(outH) * specChipSideRatio * style.chipScale).rounded())
        let chipRadius = max(1, (chipSide * specChipCornerRadiusRatio).rounded())
        let chipX = chipInsetX
        let chipY = Double(bannerY) + (Double(bannerH) - chipSide) / 2

        let chipRect = cgRect(x: CGFloat(chipX), topY: CGFloat(chipY), width: CGFloat(chipSide), height: CGFloat(chipSide), outH: outH)
        let chipPath = CGPath(roundedRect: chipRect, cornerWidth: CGFloat(chipRadius), cornerHeight: CGFloat(chipRadius), transform: nil)
        context.setFillColor(cgColor(style.chipColor))
        context.addPath(chipPath)
        context.fillPath()

        let labelFontSize = max(10.0, (chipSide * 0.62).rounded())
        let labelFont = try loadFont(path: fontPath, size: labelFontSize, index: fontIndex)
        let labelColor = cgColor((255, 255, 255))
        let labelMetrics = measureLine(label, font: labelFont, color: labelColor)
        let labelX = CGFloat(chipX) + (CGFloat(chipSide) - labelMetrics.width) / 2
        let labelCenterY = CGFloat(chipY) + CGFloat(chipSide) / 2
        drawCenteredLine(context, metrics: labelMetrics, x: labelX, centerYTopDown: labelCenterY, outH: outH)

        textStartX = CGFloat(chipX + chipSide) + CGFloat((Double(outW) * specCaptionGapRatio).rounded())
    }

    let maxTextWidth = max(20, CGFloat(outW) - textStartX - CGFloat(chipInsetX))
    let (_, metrics) = try fitFont(
        text: stepText,
        path: fontPath,
        index: fontIndex,
        startSize: fontSize,
        maxWidth: maxTextWidth,
        minSize: 20,
        color: captionColor
    )
    drawCenteredLine(context, metrics: metrics, x: textStartX, centerYTopDown: centerY, outH: outH)

    guard let image = context.makeImage() else { throw RenderError.contextCreationFailed }
    return image
}

func renderCaption(_ request: JSONDict) throws -> CGImage {
    let outW = try requireInt(request, "outW")
    let outH = try requireInt(request, "outH")
    let fontPath = asString(request["fontPath"]) ?? defaultFontPath
    let fontIndex = asInt(request["fontIndex"]) ?? defaultFontIndex
    let fontSize = asDouble(request["fontSize"]) ?? 48
    let text = try requireString(request, "text")
    let style = BannerStyle.resolve(request["style"])

    let context = try makeRGBAContext(width: outW, height: outH)
    let (_, _, centerY) = drawBanner(context, outW: outW, outH: outH, style: style)

    let insetX = (Double(outW) * specChipInsetXRatio).rounded()
    let maxTextWidth = max(20, CGFloat(outW) - CGFloat(insetX) * 2)
    let captionColor = cgColor(specCaptionTextColor)
    let (_, metrics) = try fitFont(
        text: text,
        path: fontPath,
        index: fontIndex,
        startSize: fontSize,
        maxWidth: maxTextWidth,
        minSize: 32,
        color: captionColor
    )
    let x = (CGFloat(outW) - metrics.width) / 2
    drawCenteredLine(context, metrics: metrics, x: x, centerYTopDown: centerY, outH: outH)

    guard let image = context.makeImage() else { throw RenderError.contextCreationFailed }
    return image
}

/// Full-frame intro/outro title card: opaque gradient background using the
/// SAME endpoints as the polish framing gradient (framing.ts `gradients`
/// c0=0x12141a top-left -> c1=0x20242e bottom-right) so the card reads as
/// part of the framed scene it fades into, with large centered typography.
func renderTitleCard(_ request: JSONDict) throws -> CGImage {
    let outW = try requireInt(request, "outW")
    let outH = try requireInt(request, "outH")
    let fontPath = asString(request["fontPath"]) ?? defaultFontPath
    let fontIndex = asInt(request["fontIndex"]) ?? defaultFontIndex
    let fontSize = asDouble(request["fontSize"]) ?? 112
    let text = try requireString(request, "text")

    let context = try makeRGBAContext(width: outW, height: outH)

    let top: (Int, Int, Int) = (18, 20, 26) // 0x12141a
    let bottom: (Int, Int, Int) = (32, 36, 46) // 0x20242e
    let colors: [CGFloat] = [
        CGFloat(top.0) / 255.0, CGFloat(top.1) / 255.0, CGFloat(top.2) / 255.0, 1.0,
        CGFloat(bottom.0) / 255.0, CGFloat(bottom.1) / 255.0, CGFloat(bottom.2) / 255.0, 1.0,
    ]
    if let gradient = CGGradient(colorSpace: rgbColorSpace, colorComponents: colors, locations: [0, 1], count: 2) {
        // Top-left -> bottom-right in top-down coordinates; CG's origin is
        // bottom-left, so top-left is (0, outH).
        context.drawLinearGradient(
            gradient,
            start: CGPoint(x: 0, y: CGFloat(outH)),
            end: CGPoint(x: CGFloat(outW), y: 0),
            options: []
        )
    }

    let maxTextWidth = max(20, CGFloat(outW) * 0.84)
    let captionColor = cgColor(specCaptionTextColor)
    let (_, metrics) = try fitFont(
        text: text,
        path: fontPath,
        index: fontIndex,
        startSize: fontSize,
        maxWidth: maxTextWidth,
        minSize: 40,
        color: captionColor
    )
    let x = (CGFloat(outW) - metrics.width) / 2
    drawCenteredLine(context, metrics: metrics, x: x, centerYTopDown: CGFloat(outH) / 2, outH: outH)

    guard let image = context.makeImage() else { throw RenderError.contextCreationFailed }
    return image
}

// MARK: - frame-background / frame-mask (legacy frame-chrome; no current callers,
// kept for output-contract parity with the retired Pillow tier)

func renderFrameBackground(_ request: JSONDict) throws -> CGImage {
    let outW = try requireInt(request, "outW")
    let outH = try requireInt(request, "outH")
    let contentW = try requireInt(request, "contentW")
    let contentH = try requireInt(request, "contentH")
    let contentX = try requireInt(request, "contentX")
    let contentY = try requireInt(request, "contentY")
    let radius = try requireInt(request, "cornerRadius")

    let context = try makeRGBAContext(width: outW, height: outH)

    let top: (Int, Int, Int) = (18, 20, 26)
    let bottom: (Int, Int, Int) = (32, 36, 46)
    let colors: [CGFloat] = [
        CGFloat(top.0) / 255.0, CGFloat(top.1) / 255.0, CGFloat(top.2) / 255.0, 1.0,
        CGFloat(bottom.0) / 255.0, CGFloat(bottom.1) / 255.0, CGFloat(bottom.2) / 255.0, 1.0,
    ]
    if let gradient = CGGradient(colorSpace: rgbColorSpace, colorComponents: colors, locations: [0, 1], count: 2) {
        context.drawLinearGradient(
            gradient,
            start: CGPoint(x: 0, y: CGFloat(outH)),
            end: CGPoint(x: 0, y: 0),
            options: []
        )
    }

    let ciContext = CIContext(options: [.useSoftwareRenderer: true])
    let shadowSpecs: [(offset: Double, alpha: Double, sigma: Double)] = [
        (14, 0.20, 24),
        (10, 0.26, 18),
        (24, 0.14, 8),
    ]

    for spec in shadowSpecs {
        let grayContext = try makeGrayContext(width: outW, height: outH)
        grayContext.setFillColor(gray: 0, alpha: 1)
        grayContext.fill(CGRect(x: 0, y: 0, width: outW, height: outH))

        let shadowRect = cgRect(
            x: CGFloat(contentX),
            topY: CGFloat(contentY) + CGFloat(spec.offset),
            width: CGFloat(contentW),
            height: CGFloat(contentH),
            outH: outH
        )
        let shadowPath = CGPath(roundedRect: shadowRect, cornerWidth: CGFloat(radius), cornerHeight: CGFloat(radius), transform: nil)
        grayContext.setFillColor(gray: CGFloat(spec.alpha), alpha: 1)
        grayContext.addPath(shadowPath)
        grayContext.fillPath()

        guard let grayImage = grayContext.makeImage() else { continue }
        let extent = CGRect(x: 0, y: 0, width: outW, height: outH)
        let blurred = CIImage(cgImage: grayImage)
            .clampedToExtent()
            .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: spec.sigma])
            .cropped(to: extent)

        guard let maskImage = ciContext.createCGImage(
            blurred,
            from: extent,
            format: .L8,
            colorSpace: CGColorSpaceCreateDeviceGray()
        ) else { continue }

        context.saveGState()
        context.clip(to: extent, mask: maskImage)
        context.setFillColor(cgColor((0, 0, 0)))
        context.fill(extent)
        context.restoreGState()
    }

    guard let image = context.makeImage() else { throw RenderError.contextCreationFailed }
    return image
}

func renderFrameMask(_ request: JSONDict) throws -> CGImage {
    let contentW = try requireInt(request, "contentW")
    let contentH = try requireInt(request, "contentH")
    let radius = try requireInt(request, "cornerRadius")

    let context = try makeGrayContext(width: contentW, height: contentH)
    context.setFillColor(gray: 0, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: contentW, height: contentH))

    let rect = CGRect(x: 0, y: 0, width: contentW, height: contentH)
    let path = CGPath(roundedRect: rect, cornerWidth: CGFloat(radius), cornerHeight: CGFloat(radius), transform: nil)
    context.setFillColor(gray: 1, alpha: 1)
    context.addPath(path)
    context.fillPath()

    guard let image = context.makeImage() else { throw RenderError.contextCreationFailed }
    return image
}

// MARK: - Entry point

func probe() -> Never {
    do {
        _ = try loadFont(path: defaultFontPath, size: 40, index: defaultFontIndex)
        exit(0)
    } catch {
        fail("\(error)")
    }
}

func render() -> Never {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    guard
        let parsed = try? JSONSerialization.jsonObject(with: inputData),
        let request = parsed as? JSONDict
    else {
        fail("\(RenderError.invalidJSON)")
    }

    do {
        let kind = try requireString(request, "kind")
        let outPath = try requireString(request, "outPath")

        let image: CGImage
        switch kind {
        case "step-card":
            image = try renderStepCard(request)
        case "caption":
            image = try renderCaption(request)
        case "title-card":
            image = try renderTitleCard(request)
        case "frame-background":
            image = try renderFrameBackground(request)
        case "frame-mask":
            image = try renderFrameMask(request)
        default:
            throw RenderError.unknownKind(kind)
        }

        try writePNG(image, to: outPath)
        exit(0)
    } catch {
        fail("\(error)")
    }
}

let arguments = CommandLine.arguments
if arguments.contains("--probe") {
    probe()
} else {
    render()
}
