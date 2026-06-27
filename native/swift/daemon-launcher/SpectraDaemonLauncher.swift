import Foundation
import Darwin

enum LauncherError: Error, CustomStringConvertible {
    case missingValue(String)
    case nodeNotFound
    case daemonScriptNotFound(String)

    var description: String {
        switch self {
        case .missingValue(let flag):
            return "Missing value for \(flag)"
        case .nodeNotFound:
            return "Node not found in PATH or standard install locations"
        case .daemonScriptNotFound(let path):
            return "Daemon script not found at \(path)"
        }
    }
}

struct Options {
    var nodePath: String?
    var daemonScriptPath: String?
}

func parseOptions(_ args: [String]) throws -> Options {
    var options = Options()
    var index = 1

    func value(after flag: String) throws -> String {
        let next = index + 1
        guard next < args.count else { throw LauncherError.missingValue(flag) }
        index = next
        return args[next]
    }

    while index < args.count {
        let arg = args[index]
        switch arg {
        case "--node":
            options.nodePath = try value(after: arg)
        case "--script":
            options.daemonScriptPath = try value(after: arg)
        default:
            break
        }
        index += 1
    }
    return options
}

func resolveNodePath(_ explicit: String?) throws -> String {
    if let explicit, FileManager.default.isExecutableFile(atPath: explicit) {
        return explicit
    }

    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
        return candidate
    }

    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/zsh")
    task.arguments = ["-lc", "command -v node"]
    let pipe = Pipe()
    task.standardOutput = pipe
    try task.run()
    task.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let path = (String(data: data, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !path.isEmpty, FileManager.default.isExecutableFile(atPath: path) {
        return path
    }
    throw LauncherError.nodeNotFound
}

func resolveDaemonScriptPath(_ explicit: String?) throws -> String {
    let path = explicit ?? "\(NSHomeDirectory())/.spectra/dist/cli/index.js"
    guard FileManager.default.isReadableFile(atPath: path) else {
        throw LauncherError.daemonScriptNotFound(path)
    }
    return path
}

do {
    let options = try parseOptions(CommandLine.arguments)
    let nodePath = try resolveNodePath(options.nodePath)
    let scriptPath = try resolveDaemonScriptPath(options.daemonScriptPath)

    let process = Process()
    process.executableURL = URL(fileURLWithPath: nodePath)
    process.arguments = [scriptPath, "daemon"]
    process.environment = ProcessInfo.processInfo.environment.merging([
        "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    ]) { current, _ in current }
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let signalQueue = DispatchQueue(label: "spectra.daemon-launcher.signals")
    let sources = [SIGINT, SIGTERM].map { signalNumber in
        let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: signalQueue)
        source.setEventHandler {
            if process.isRunning {
                process.terminate()
            }
        }
        source.resume()
        return source
    }

    try process.run()
    process.waitUntilExit()
    sources.forEach { $0.cancel() }
    if process.terminationReason == .uncaughtSignal {
        exit(128 + process.terminationStatus)
    }
    exit(process.terminationStatus)
} catch {
    fputs("spectra-daemon-launcher: \(error)\n", stderr)
    exit(1)
}
