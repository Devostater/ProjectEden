// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

using UnrealBuildTool;

public class __NAME__HostEditorTarget : TargetRules
{
	public __NAME__HostEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("__NAME__Host");
	}
}