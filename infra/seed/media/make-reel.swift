// Makes a vertical H.264 .mp4 from a few pictures: each is shown in turn with a slow zoom and a short cross-fade.
// Usage: swiftc -O make-reel.swift -o make-reel && ./make-reel out.mp4 seconds fps width height crossfadeSeconds a.png b.png ...
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let a = CommandLine.arguments
guard a.count >= 8 else { FileHandle.standardError.write("usage: out.mp4 seconds fps width height fade img...\n".data(using: .utf8)!); exit(2) }
let out = URL(fileURLWithPath: a[1]); let seconds = Double(a[2])!; let fps = Int(a[3])!; let W = Int(a[4])!; let H = Int(a[5])!; let fade = Double(a[6])!
let images: [CGImage] = a[7...].map { p in
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}
try? FileManager.default.removeItem(at: out)
let writer = try AVAssetWriter(outputURL: out, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 900_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel, AVVideoMaxKeyFrameIntervalKey: fps * 2],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H])
writer.add(input); writer.startWriting(); writer.startSession(atSourceTime: .zero)

let total = Int(seconds * Double(fps)); let seg = seconds / Double(images.count)
func draw(_ ctx: CGContext, _ img: CGImage, zoom: CGFloat, panX: CGFloat, alpha: CGFloat) {
  let w = CGFloat(W) * zoom, h = CGFloat(H) * zoom
  ctx.setAlpha(alpha)
  ctx.draw(img, in: CGRect(x: (CGFloat(W) - w) / 2 + panX, y: (CGFloat(H) - h) / 2, width: w, height: h))
}
for f in 0..<total {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  let buf = pb!
  CVPixelBufferLockBaseAddress(buf, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buf), width: W, height: H, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  let t = Double(f) / Double(fps)
  let i = min(images.count - 1, Int(t / seg)); let u = CGFloat((t - Double(i) * seg) / seg)
  let dir: CGFloat = i % 2 == 0 ? 1 : -1
  draw(ctx, images[i], zoom: 1.0 + 0.10 * u, panX: dir * 14 * u, alpha: 1)
  let toNext = (Double(i + 1) * seg) - t
  if i + 1 < images.count && toNext < fade {
    let x = CGFloat(1 - toNext / fade)
    draw(ctx, images[i + 1], zoom: 1.0, panX: 0, alpha: x)
  }
  CVPixelBufferUnlockBaseAddress(buf, [])
  adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: CMTimeScale(fps)))
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
if writer.status != .completed { FileHandle.standardError.write("failed: \(String(describing: writer.error))\n".data(using: .utf8)!); exit(1) }
print("wrote \(out.path)")
