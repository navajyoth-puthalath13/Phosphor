class ScreenQuality < Formula
  desc "See how a UI reproduces on other displays: luminance, contrast, gamut, gamma, more"
  homepage "https://github.com/navajyoth-puthalath13/Phosphor"
  # Pinned to a commit tarball; switch to refs/tags/vX.Y.Z once releases are tagged.
  url "https://github.com/navajyoth-puthalath13/Phosphor/archive/0c8b264b954f3cfc9667c2d41b0fdb533eeb4ff0.tar.gz"
  version "0.1.0"
  sha256 "f822346b47b3f86779457f666e099c674335cb50dd5be05d13502100c413e9b9"
  head "https://github.com/navajyoth-puthalath13/Phosphor.git", branch: "main"

  depends_on :macos
  depends_on "node"

  def install
    system "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"
    libexec.install "dist", "node_modules", "package.json"

    # The CLI looks for its display helper at <package>/native/macos-helper/build/.
    helper_dir = libexec/"native/macos-helper/build"
    helper_dir.mkpath
    system "swiftc", "-O", "-module-cache-path", buildpath/"swift-module-cache",
           "native/macos-helper/main.swift", "-o", helper_dir/"screen-quality-helper"

    (bin/"screen-quality").write_env_script libexec/"dist/apps/cli/screen-quality.js",
                                            PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match "budget-tn", shell_output("#{bin}/screen-quality profiles")

    # 2×1 PNG: white and dark grey. A budget TN viewed on a 400-nit display must dim the white.
    png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4AWP4DwQiIiL/ARuiBTif3Mi/AAAAAElFTkSuQmCC"
    (testpath/"in.png").binwrite png.unpack1("m")
    system bin/"screen-quality", "simulate", "in.png", "-t", "budget-tn", "-o", "out.png", "--viewer-nits", "400"
    assert_path_exists testpath/"out.png"

    # The native helper runs and reports JSON (display list may be empty in a headless session).
    assert_match "screen-quality-macos-helper",
                 shell_output("#{libexec}/native/macos-helper/build/screen-quality-helper")
  end
end
