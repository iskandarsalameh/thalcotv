# Installing Thalco TV on a Fire TV Stick 4K Select

The Fire TV Stick 4K Select runs Vega OS, which installs `.vpkg` packages.
Apps that are not in the Amazon Appstore are installed ("sideloaded") from a
computer with Amazon's Vega developer tools. This is Amazon's own process and
needs three things:

- a **Mac or an Ubuntu Linux computer** (Amazon's tools do not run on Windows),
- a free **Amazon Developer account** (https://developer.amazon.com),
- the stick and the computer on the **same network**.

## Quick way: one script (Ubuntu, including Ubuntu on Windows)

`scripts/install-on-stick.sh` does steps 2 to 5 below and asks for the code
and IP address as it goes. On Windows, open the **Ubuntu** app (WSL), save
`thalcotv_armv7.vpkg` and `install-on-stick.sh` in your Windows Downloads
folder, then run:

```bash
bash /mnt/c/Users/*/Downloads/install-on-stick.sh
```

If Ubuntu is not set up on Windows yet, open PowerShell as administrator, run
`wsl --install -d Ubuntu`, and restart. If the stick cannot be reached from
Ubuntu, turn off any VPN on Windows and try again.

The rest of this page is the same process by hand.

## 1. Get the package

Open the repository on GitHub, go to **Releases**, and download
`thalcotv_armv7.vpkg` from the release named "Thalco TV package". The Fire TV
Stick 4K Select needs the `armv7` file.

If there is no release yet, open **Actions > Build vpkg > Run workflow** and
wait for it to finish.

## 2. Install the Vega tools on the computer

```bash
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash
```

```bash
source ~/vega/env
```

```bash
vega --version
```

Amazon's instructions, with prerequisites for each system:
https://developer.amazon.com/docs/vega/latest/install-vega-sdk.html

## 3. Turn on Developer Mode on the stick

1. On the stick: **Settings > My Fire TV > About**. Highlight the device name
   and press Select seven times until "You are now a developer" appears.
2. Go back to **My Fire TV > Developer Options > Developer Mode** and choose
   Continue. A 6-digit code appears (valid for 5 minutes).
3. On the computer, sign in with your Amazon Developer account:

```bash
vega devmode login
```

4. Enter the code from the TV (the stick restarts):

```bash
vega devmode enable-device --code 123456
```

## 4. Connect over the network

1. On the stick: **Developer Options > Connection Mode > TCP/IP**, choose
   "Use standard port 5555". The stick restarts.
2. Find the stick's IP address under **Settings > My Fire TV > About > Network**.
3. On the computer (replace the address with yours):

```bash
vega exec vda connect 192.168.1.50:5555
```

```bash
vega device list
```

## 5. Install and start

```bash
vega device install-app --packagePath thalcotv_armv7.vpkg
```

```bash
vega device launch-app --appName com.thalco.tv.main
```

Thalco TV now appears with your apps on the Fire TV home screen.

## Updating

- **The interface updates itself.** It is loaded from the repository's
  published site each time the app starts, so new features arrive without
  touching the stick. Settings > About > Check for Update shows the running
  build.
- **The package** only changes when the shell does. To update it, download the
  newer `.vpkg` and run the install command from step 5 again; your library
  and settings are kept.

## Removing

```bash
vega device uninstall-app --appName com.thalco.tv.main
```

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Can't reach Thalco TV" with a Try Again button | The stick has no internet, or neither the published interface nor the packaged copy could start. Check the connection and press Try Again. |
| The app opens but never shows new features | GitHub Pages is not enabled for the repository, so the stick is using the copy inside the package. See "One-time setup" in the README. |
| `vega device list` shows nothing | Confirm both devices are on the same network, repeat the `vda connect` command, and check that Connection Mode is TCP/IP. |
| A title lists sources but none will play | Open Settings > About > Device Capabilities to see what the stick decodes, try another source, or lower Maximum Quality. |
| Torrent sources are greyed out | They need a streaming server: Settings > Streaming Server. |
