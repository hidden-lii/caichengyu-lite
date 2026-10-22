// 列出窗口信息，供 scripts/app-shot.mjs 找到「猜成语」窗口的 id 与位置：
//   swift scripts/windowid.swift <进程名子串>
// 输出一行 JSON：{ "id": 123, "x": .., "y": .., "w": .., "h": .. }；找不到时输出 null。
import CoreGraphics
import Foundation

let needle = CommandLine.arguments.dropFirst().first?.lowercased() ?? "caichengyu"
let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String ?? "").lowercased()
    let layer = w[kCGWindowLayer as String] as? Int ?? 0
    guard owner.contains(needle), layer == 0,
          let id = w[kCGWindowNumber as String] as? Int,
          let b = w[kCGWindowBounds as String] as? [String: Double] else { continue }
    if (b["Width"] ?? 0) < 200 { continue }
    print("{\"id\": \(id), \"x\": \(b["X"] ?? 0), \"y\": \(b["Y"] ?? 0), \"w\": \(b["Width"] ?? 0), \"h\": \(b["Height"] ?? 0)}")
    exit(0)
}
print("null")
