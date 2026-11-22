# Restore an EDEN backup

EDEN checks that each new backup ZIP can be unpacked and contains the expected files before it clears older copies. It checks the extra copy too, if you set one up.

1. On the EDEN computer, find a backup ZIP. In EDEN, go to **Account → Settings → Backups** and click **Open folder**. If EDEN is closed, paste `%USERPROFILE%\.eden-hub\backups` into File Explorer. You can also use a ZIP from your extra backup folder.
2. Open PowerShell in the `eden-ai-dashboard` folder. Run the command below with the full path to your ZIP and a new folder name. The new folder's parent must already exist. You can run this with EDEN closed and without installing its npm packages.

   ```powershell
   node scripts/restore-backup.mjs "C:\path\to\eden-hub-backup.zip" "$env:LOCALAPPDATA\Eden restore"
   ```

3. Open the new folder in File Explorer and check the files you need. Turn on **View → Show → Hidden items** if needed. The command checks that the ZIP unpacks and includes the dashboard's main files. The saved data in an older ZIP depends on what existed when it was made. If a ZIP fails or the files you need are missing, try an older one with a new folder name.

The command leaves your running copy and live files alone. Use it with ZIPs made by your EDEN install. Keep the ZIP and the restored folder private because they can contain chats and API keys. Remove the scratch folder when you are done.

A backup ZIP contains a copy of the dashboard files and saved data from that time. **Code history → Undo** rolls back a code update. Use the ZIP to recover saved data such as projects and chats.

## Undo an update when EDEN cannot start

Close EDEN and its supervisor window. Run **Recover Eden.bat** in the dashboard folder, then run **Start Eden.bat** after recovery succeeds. The supervisor stops after three consecutive failed boots and prints the recovery command in its log.

Recovery restores the files touched by the latest applied EDEN update and the dashboard build saved just before it. If you edited any of those files since Apply, review and save your edits first. To explicitly replace those edits, run `node scripts/recover.mjs --force` in the dashboard folder. Updates applied before offline recovery was added have no paired build for this command.
