// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

using UnrealBuildTool;

public class __NAME__HostTarget : TargetRules
{
	public __NAME__HostTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("__NAME__Host");
	}
}