// native/swift/TestApp/TestApp.swift
import SwiftUI

@main
struct SpectraTestApp: App {
    var body: some Scene {
        WindowGroup("Spectra Test") {
            TabView {
                ControlsTab()
                    .tabItem { Label("Controls", systemImage: "slider.horizontal.3") }
                ListsTab()
                    .tabItem { Label("Lists", systemImage: "list.bullet") }
                FormsTab()
                    .tabItem { Label("Forms", systemImage: "doc.text") }
            }
            .frame(minWidth: 400, minHeight: 300)
        }
    }
}

// ─── Tab 1: Controls ──────────────────────────────────────

struct ControlsTab: View {
    @State private var clickCount = 0
    @State private var textValue = ""
    @State private var isDarkMode = false
    @State private var sliderValue = 50.0

    var body: some View {
        VStack(spacing: 16) {
            Button("Click Me") {
                clickCount += 1
            }
            .accessibilityIdentifier("spectra.controls.clickButton")

            Text("Clicked: \(clickCount)")
                .accessibilityIdentifier("spectra.controls.clickCount")

            TextField("Enter text", text: $textValue)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("spectra.controls.textField")

            Toggle("Dark Mode", isOn: $isDarkMode)
                .accessibilityIdentifier("spectra.controls.darkModeSwitch")

            HStack {
                Text("Slider: \(Int(sliderValue))")
                Slider(value: $sliderValue, in: 0...100)
                    .accessibilityIdentifier("spectra.controls.slider")
            }
        }
        .padding()
    }
}

// ─── Tab 2: Lists ─────────────────────────────────────────

struct ListsTab: View {
    var body: some View {
        List {
            ForEach(1...5, id: \.self) { i in
                HStack {
                    Text("Item \(i)")
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundColor(.secondary)
                }
                .accessibilityIdentifier("spectra.lists.item\(i)")
            }
        }
    }
}

// ─── Tab 3: Forms ─────────────────────────────────────────

struct FormsTab: View {
    @State private var name = ""
    @State private var email = ""
    @State private var country = "US"

    let countries = ["US", "UK", "CA"]

    var body: some View {
        Form {
            TextField("Name", text: $name)
                .accessibilityIdentifier("spectra.forms.nameField")

            TextField("Email", text: $email)
                .accessibilityIdentifier("spectra.forms.emailField")

            Picker("Country", selection: $country) {
                ForEach(countries, id: \.self) { c in
                    Text(c).tag(c)
                }
            }
            .accessibilityIdentifier("spectra.forms.countryPicker")

            Button("Submit") {
                // no-op for testing
            }
            .accessibilityIdentifier("spectra.forms.submitButton")
        }
        .padding()
    }
}
