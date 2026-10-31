class Phosphor < Formula
  desc "See how a UI reproduces on other displays: luminance, contrast, gamut, gamma, more"
  homepage "https://github.com/navajyoth-puthalath13/Phosphor"
  # Pinned to a commit tarball; switch to refs/tags/vX.Y.Z once releases are tagged.
  url "https://github.com/navajyoth-puthalath13/Phosphor/archive/6a2ac0d55cec3705bb69d6172aa5db1a72beabd8.tar.gz"
  version "0.3.0"
  sha256 "938aeb66484f2d38b994781307b8905bdd68a28eba4d7efe0a59d405d61b8a97"
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
           "native/macos-helper/main.swift", "-o", helper_dir/"phosphor-helper"

    (bin/"phosphor").write_env_script libexec/"dist/apps/cli/phosphor.js",
                                            PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  def caveats
    <<~EOS
      Connect your browser and install the Phosphor DevTools extension:
        phosphor setup
      Then open DevTools on any page and choose the "Phosphor" tab.
      Run `phosphor setup` again after `brew upgrade phosphor`.
    EOS
  end

  test do
    assert_match "budget-tn", shell_output("#{bin}/phosphor profiles")
    assert_match "Live on page", shell_output("#{bin}/phosphor guide")
    assert_path_exists libexec/"dist/extension/manifest.json"

    # 2×1 PNG: white and dark grey. A budget TN viewed on a 400-nit display must dim the white.
    png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4AWP4DwQiIiL/ARuiBTif3Mi/AAAAAElFTkSuQmCC"
    (testpath/"in.png").binwrite png.unpack1("m")
    system bin/"phosphor", "simulate", "in.png", "-t", "budget-tn", "-o", "out.png", "--viewer-nits", "400"
    assert_path_exists testpath/"out.png"

    # The native helper runs and reports JSON (display list may be empty in a headless session).
    assert_match "phosphor-macos-helper",
                 shell_output("#{libexec}/native/macos-helper/build/phosphor-helper")
  end
end
