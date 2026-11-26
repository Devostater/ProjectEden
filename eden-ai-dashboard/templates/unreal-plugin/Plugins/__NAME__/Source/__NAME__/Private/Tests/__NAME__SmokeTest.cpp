// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

#include "Misc/AutomationTest.h"
#include "Modules/ModuleManager.h"
#include "__NAME__Module.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(F__NAME__SmokeTest, "__NAME__.Smoke",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ProductFilter)

bool F__NAME__SmokeTest::RunTest(const FString& Parameters)
{
	TestTrue(TEXT("The __NAME__ module is loaded"), FModuleManager::Get().IsModuleLoaded(TEXT("__NAME__")));
	TestEqual(TEXT("Greeting"), F__NAME__Module::Greeting(), FString(TEXT("Hello from __NAME__")));
	return true;
}

#endif