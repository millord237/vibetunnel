# Code Signing Setup for VibeTunnel

This project uses xcconfig files to manage developer team settings, allowing multiple developers to work on the project without constantly changing the code signing configuration in git.

## Initial Setup

1. Copy the template file to create your local configuration:
   ```bash
   cp ../apple/Local.xcconfig.template ../apple/Local.xcconfig
   ```

2. Edit `../apple/Local.xcconfig` and add your personal development team ID:
   ```
   DEVELOPMENT_TEAM = YOUR_TEAM_ID_HERE
   ```

   You can find your team ID in Xcode:
   - Open Xcode → Preferences (or Settings on newer versions)
   - Go to Accounts tab
   - Select your Apple ID
   - Look for your Team ID in the team details

3. Open the project in Xcode. It should now use your personal development team automatically.

## How It Works

- `VibeTunnel/Shared.xcconfig` - Contains shared configuration and includes the local settings
- `../apple/Local.xcconfig` - Your personal settings (ignored by git)
- `../apple/Local.xcconfig.template` - Template for new developers

The project is configured to use these xcconfig files for code signing settings, so each developer can have their own `Config/Local.xcconfig` without affecting others.

## Important Notes

- Never commit `../apple/Local.xcconfig` to git (it's already in .gitignore)
- If you need to override other settings locally, you can add them to your `../apple/Local.xcconfig`
- The xcconfig files are automatically loaded by Xcode when you open the project