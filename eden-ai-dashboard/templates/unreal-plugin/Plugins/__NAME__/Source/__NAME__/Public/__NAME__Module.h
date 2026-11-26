// Copyright __YEAR__ __PUBLISHER__. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleInterface.h"

class __NAME_UPPER___API F__NAME__Module : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	/** A first function to build on. The automation test checks it. */
	static FString Greeting();
};