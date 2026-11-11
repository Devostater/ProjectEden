' Opens Eden AI Hub. If the hub isn't running, it is started in the background first and kept running
' by scripts\hub-supervisor.mjs (log: .eden-logs\hub.log). No console window appears.
' The app window opens straight away and shows "Starting the hub..." until the hub answers.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = appDir
shell.Run "node """ & appDir & "\scripts\hub-supervisor.mjs"" --open", 0, False
