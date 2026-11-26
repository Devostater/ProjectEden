// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

using UnrealBuildTool;

public class __NAME__Host : ModuleRules
{
	public __NAME__Host(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
	}
}