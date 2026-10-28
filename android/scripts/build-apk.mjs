// npm run android:build -> dist-android/Photobooth-<version>.apk, ready to install on a phone.
// Steps: production web build, copy it into the app (prepare-web.mjs), JVM unit tests, signed release APK.
//
// Needs JDK 17 + Android SDK (platform 35, build-tools 35). Uses JAVA_HOME / ANDROID_HOME when set,
// otherwise %LOCALAPPDATA%\pb-android-toolchain\{jdk,sdk}.
//
// Signing: the first build creates %USERPROFILE%\.photobooth\android-release.jks (+ .json with its
// password). Back both up and never commit them: every later APK must be signed with the same key,
// or Android refuses to install it over the kiosk app that is already there.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { prepareWeb } from './prepare-web.mjs';

const root = join(import.meta.dirname, '..', '..');
const androidDir = join(root, 'android');
const isWindows = process.platform === 'win32';
const toolchain = join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'pb-android-toolchain');
const javaHome = process.env.JAVA_HOME || join(toolchain, 'jdk');
const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(toolchain, 'sdk');

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
}

function versionInfo() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let sha = 'dev';
  try { sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  // Minutes since 2026-01-01: every build installs over the previous one.
  const code = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000);
  return { name: `${pkg.version}-android.${sha}`, code };
}

function releaseKey() {
  const dir = join(homedir(), '.photobooth');
  const keystore = join(dir, 'android-release.jks');
  const secretFile = join(dir, 'android-release.json');
  if (!existsSync(keystore)) {
    mkdirSync(dir, { recursive: true });
    const password = randomBytes(18).toString('hex');
    run(join(javaHome, 'bin', isWindows ? 'keytool.exe' : 'keytool'), [
      '-genkeypair', '-keystore', keystore, '-alias', 'photobooth', '-keyalg', 'RSA', '-keysize', '3072',
      '-validity', '10000', '-storepass', password, '-keypass', password, '-dname', 'CN=Photobooth Kiosk',
    ], { shell: false });
    writeFileSync(secretFile, JSON.stringify({ alias: 'photobooth', password }, null, 2));
    console.log(`\nNew Android signing key: ${keystore}\nBack up it and ${secretFile}; never commit them.\n`);
  }
  const { alias, password } = JSON.parse(readFileSync(secretFile, 'utf8'));
  return { keystore, alias, password };
}

for (const [what, path] of [['JDK', join(javaHome, 'bin')], ['Android SDK', join(sdkDir, 'platforms')]]) {
  if (!existsSync(path)) throw new Error(`${what} not found at ${path} (set JAVA_HOME / ANDROID_HOME)`);
}

run('npm', ['run', 'build'], { cwd: root });
const defaults = await prepareWeb();
console.log(`web assets copied (${defaults.supabaseUrl})`);

writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${sdkDir.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`);
const version = versionInfo();
const key = releaseKey();
// .bat files only run through the shell, and the checkout path may contain spaces.
run(isWindows ? `"${join(androidDir, 'gradlew.bat')}"` : './gradlew', [
  '--no-daemon', 'testReleaseUnitTest', 'assembleRelease', `-PpbVersionName=${version.name}`, `-PpbVersionCode=${version.code}`,
], {
  cwd: androidDir,
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdkDir,
    PB_ANDROID_KEYSTORE: key.keystore, PB_ANDROID_KEY_ALIAS: key.alias, PB_ANDROID_KEYSTORE_PASSWORD: key.password },
});

const outDir = join(root, 'dist-android');
mkdirSync(outDir, { recursive: true });
const apk = join(outDir, `Photobooth-${version.name}.apk`);
copyFileSync(join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), apk);
// What publish-apk.mjs uploads.
writeFileSync(join(outDir, 'latest.json'), JSON.stringify({ file: apk, versionName: version.name, versionCode: version.code }, null, 2));
console.log(`\nAPK: ${apk}`);
