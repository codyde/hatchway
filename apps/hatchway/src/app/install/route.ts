import { NextResponse } from "next/server";

const GITHUB_INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/codyde/hatchway/main/install-cli.sh";

/**
 * GET /install
 * Proxies the CLI install script from GitHub
 * Usage: curl -fsSL https://hatchway.sh/install | bash
 */
export async function GET() {
  try {
    const response = await fetch(GITHUB_INSTALL_SCRIPT_URL, {
      headers: {
        "User-Agent": "Hatchway-Install-Proxy",
      },
      // Cache for 5 minutes to reduce GitHub API calls
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      console.error(
        "[install] Failed to fetch install script:",
        response.status,
        response.statusText
      );
      return new NextResponse(
        "# Error: Failed to fetch install script\necho 'Failed to download install script. Please try again or visit https://github.com/codyde/hatchway'\nexit 1",
        {
          status: 502,
          headers: {
            "Content-Type": "text/x-shellscript; charset=utf-8",
          },
        }
      );
    }

    const scriptContent = await response.text();

    return new NextResponse(scriptContent, {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Content-Disposition": "inline; filename=install-cli.sh",
        // Allow caching but revalidate
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (error) {
    console.error("[install] Error proxying install script:", error);
    return new NextResponse(
      "# Error: Failed to fetch install script\necho 'Failed to download install script. Please try again or visit https://github.com/codyde/hatchway'\nexit 1",
      {
        status: 500,
        headers: {
          "Content-Type": "text/x-shellscript; charset=utf-8",
        },
      }
    );
  }
}
