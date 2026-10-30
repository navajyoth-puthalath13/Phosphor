// screen-quality-helper: dumps raw macOS display facts as JSON on stdout.
// It interprets nothing — EDID/ICC parsing and provenance live in engines/display-detection (TypeScript, tested).
// Build: native/macos-helper/build.sh

import AppKit
import CoreGraphics
import Foundation
import IOKit

let helperVersion = "0.1.0"

func onlineDisplays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    guard CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [] }
    return Array(ids.prefix(Int(count)))
}

func screen(for id: CGDirectDisplayID) -> NSScreen? {
    NSScreen.screens.first {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id
    }
}

func describe(_ id: CGDirectDisplayID) -> [String: Any] {
    var d: [String: Any] = [
        "id": id,
        "main": CGDisplayIsMain(id) != 0,
        "builtIn": CGDisplayIsBuiltin(id) != 0,
        "vendor": CGDisplayVendorNumber(id),
        "model": CGDisplayModelNumber(id),
        "serial": CGDisplaySerialNumber(id),
    ]
    if let mode = CGDisplayCopyDisplayMode(id) {
        d["pixels"] = ["width": mode.pixelWidth, "height": mode.pixelHeight]
        d["points"] = ["width": mode.width, "height": mode.height]
        d["refreshHz"] = mode.refreshRate  // 0 means "not reported" (common on built-in panels)
    }
    let mm = CGDisplayScreenSize(id)
    if mm.width > 0 && mm.height > 0 { d["mm"] = ["width": mm.width, "height": mm.height] }

    let cs = CGDisplayCopyColorSpace(id)
    if let name = cs.name { d["colourSpaceName"] = name as String }
    if let icc = cs.copyICCData() { d["iccBase64"] = (icc as Data).base64EncodedString() }

    if let s = screen(for: id) {
        d["name"] = s.localizedName
        d["bitsPerSample"] = s.depth.bitsPerSample
        d["edrMaxPotential"] = s.maximumPotentialExtendedDynamicRangeColorComponentValue
    }
    return d
}

// EDID blobs live under different keys on Intel ("IODisplayEDID") and Apple silicon (nested in DCP
// service properties), so scan every registry entry for data that starts with the EDID header.
let edidHeader: [UInt8] = [0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x00]

func findEdids(_ value: Any, into out: inout Set<Data>) {
    if let data = value as? Data {
        if data.count >= 128 && data.count % 128 == 0 && Array(data.prefix(8)) == edidHeader { out.insert(data) }
    } else if let dict = value as? [String: Any] {
        dict.values.forEach { findEdids($0, into: &out) }
    } else if let arr = value as? [Any] {
        arr.forEach { findEdids($0, into: &out) }
    }
}

func allEdids() -> [Data] {
    var iter: io_iterator_t = 0
    guard IORegistryCreateIterator(0 /* default main port */, kIOServicePlane,
                                   IOOptionBits(kIORegistryIterateRecursively), &iter) == KERN_SUCCESS else { return [] }
    defer { IOObjectRelease(iter) }
    var found = Set<Data>()
    var entry = IOIteratorNext(iter)
    while entry != 0 {
        var props: Unmanaged<CFMutableDictionary>?
        if IORegistryEntryCreateCFProperties(entry, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS,
           let dict = props?.takeRetainedValue() as? [String: Any] {
            findEdids(dict, into: &found)
        }
        IOObjectRelease(entry)
        entry = IOIteratorNext(iter)
    }
    return found.map { $0 }
}

let os = ProcessInfo.processInfo.operatingSystemVersion
let report: [String: Any] = [
    "helper": "screen-quality-macos-helper",
    "helperVersion": helperVersion,
    "macOS": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
    "displays": onlineDisplays().map(describe),
    "edidsBase64": allEdids().map { $0.base64EncodedString() },
]

let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(json)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
