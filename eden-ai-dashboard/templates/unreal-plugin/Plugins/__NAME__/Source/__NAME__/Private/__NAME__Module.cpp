// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

#include "__NAME__Module.h"

#include "Modules/ModuleManager.h"

void F__NAME__Module::StartupModule()
{
}

void F__NAME__Module::ShutdownModule()
{
}

FString F__NAME__Module::Greeting()
{
	return TEXT("Hello from __NAME__");
}

IMPLEMENT_MODULE(F__NAME__Module, __NAME__)