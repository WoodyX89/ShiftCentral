# ShiftCentral iOS

This project is wrapped with Capacitor. The Xcode project is in `ios/`.

You need a Mac with Xcode to build or run it. This zip cannot produce a signed iPhone app on its own.

## On a Mac

1. Install Xcode from the App Store, then run:
   ```
   sudo xcode-select -s /Applications/Xcode.app
   sudo gem install cocoapods
   ```
2. Unzip this project and open a terminal in the folder.
3. Install dependencies and sync:
   ```
   npm install
   npm run cap:sync
   npm run cap:ios
   ```
4. In Xcode, pick your Team under Signing & Capabilities.
5. Choose a simulator or a connected iPhone and press Run.

App id: `com.shiftcentral.app`
