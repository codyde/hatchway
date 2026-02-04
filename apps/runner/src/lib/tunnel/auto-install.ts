import { execSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const CLOUDFLARED_GITHUB = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/**
 * Get the local bin directory for cloudflared installation
 */
function getBinDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const binDir = resolve(homeDir, '.hatchway', 'bin');

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  return binDir;
}

/**
 * Detect the appropriate cloudflared binary name for this platform
 */
function getCloudflaredBinaryName(): string {
  const plat = platform();
  const architecture = arch();

  if (plat === 'darwin') {
    if (architecture === 'arm64') {
      return 'cloudflared-darwin-arm64.tgz';
    }
    return 'cloudflared-darwin-amd64.tgz';
  } else if (plat === 'linux') {
    if (architecture === 'arm64') {
      return 'cloudflared-linux-arm64';
    }
    return 'cloudflared-linux-amd64';
  } else if (plat === 'win32') {
    return 'cloudflared-windows-amd64.exe';
  }

  throw new Error(`Unsupported platform: ${plat} ${architecture}`);
}

/**
 * Check if cloudflared is already installed (globally or locally)
 */
function checkExistingInstallation(): string | null {
  // Check global installation
  try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    return 'cloudflared';
  } catch {
    // Not installed globally
  }

  // Check local installation
  const binDir = getBinDir();
  const localPath = resolve(binDir, 'cloudflared');

  if (existsSync(localPath)) {
    return localPath;
  }

  return null;
}

/**
 * Download and install cloudflared binary
 */
async function downloadCloudflared(): Promise<string> {
  const binDir = getBinDir();
  const binaryName = getCloudflaredBinaryName();
  const downloadUrl = `${CLOUDFLARED_GITHUB}/${binaryName}`;
  const plat = platform();

  console.log(`📦 Downloading cloudflared from ${downloadUrl}...`);

  if (plat === 'darwin') {
    // macOS - download and extract tarball
    const tarPath = resolve(binDir, 'cloudflared.tgz');
    const extractDir = resolve(binDir, 'cloudflared-extract');

    execSync(`curl -L "${downloadUrl}" -o "${tarPath}"`, { stdio: 'inherit' });

    // Create extraction directory
    if (!existsSync(extractDir)) {
      mkdirSync(extractDir, { recursive: true });
    }

    // Extract
    execSync(`tar -xzf "${tarPath}" -C "${extractDir}"`, { stdio: 'inherit' });

    // Find the cloudflared binary in extracted files
    const extractedBinary = resolve(extractDir, 'cloudflared');
    const targetPath = resolve(binDir, 'cloudflared');

    // Move to bin directory
    execSync(`mv "${extractedBinary}" "${targetPath}"`, { stdio: 'inherit' });

    // Cleanup
    execSync(`rm -rf "${tarPath}" "${extractDir}"`, { stdio: 'ignore' });

    // Make executable
    chmodSync(targetPath, 0o755);

    return targetPath;
  } else if (plat === 'linux') {
    // Linux - download binary directly
    const targetPath = resolve(binDir, 'cloudflared');

    execSync(`curl -L "${downloadUrl}" -o "${targetPath}"`, { stdio: 'inherit' });
    chmodSync(targetPath, 0o755);

    return targetPath;
  } else if (plat === 'win32') {
    // Windows - download .exe
    const targetPath = resolve(binDir, 'cloudflared.exe');

    execSync(`curl -L "${downloadUrl}" -o "${targetPath}"`, { stdio: 'inherit' });

    return targetPath;
  }

  throw new Error(`Unsupported platform: ${plat}`);
}

/**
 * Ensure cloudflared is installed and return the path to the binary
 */
export async function ensureCloudflared(silent: boolean = false): Promise<string> {
  // Check if already installed
  const existing = checkExistingInstallation();
  if (existing) {
    if (!silent) {
      console.log(`✅ cloudflared found: ${existing}`);
    }
    return existing;
  }

  if (!silent) {
    console.log('📦 cloudflared not found, installing...');
  }

  try {
    const path = await downloadCloudflared();
    if (!silent) {
      console.log(`✅ cloudflared installed to: ${path}`);
    }
    return path;
  } catch (error) {
    console.error('❌ Failed to install cloudflared:', error);
    throw new Error('Failed to install cloudflared. Please install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  }
}
