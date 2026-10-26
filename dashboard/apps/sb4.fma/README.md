# Console (Sb4)
ShopBot's Console app (shown as "Console" in FabMo; app id `fabmo-sb4`, the Sb4 interface rebuilt on cards): friendly, familiar CNC interface for ShopBotters

## About
Sb4 is a FabMo App with the look and feel of the legacy Sb3 ShopBot Software -- familiar to ShopBot users, and thus a good starting point for getting comfortable with FabMo. It may also be useful for those wanting to work at the motion-coding level with digital fabrication tools as the OpenSBP language is more human-friendly and programmable than g-code. The Macro (scripting) language of FabMo is also OpenSBP so the Sb4 interface allows testing Macro concepts.

## Layout (v4.1, Oct 2026)
Sb4 now runs on the card layout of the FabMo Dashboard (tool_status) app: the Sb4 command panel is one card among Jobs, Machine, Current Tool, Shop Tools, Default Speeds, Apps and (for ATC tools) Tools. Cards can be hidden (gear) and rearranged (pencil); the layout and theme are remembered per browser. See `/fabmo/doc/sb4_cards.md` for how the code is put together.

## Getting Started
Starting the App will yield a CNC experinece and offer an interaction somewhat like the older, Windows-based ShopBot Software. The ShopBot CNC language, OpenSBP, is supported along with standard g-code. Interaction with the system is via a menuing system and command line input, similar to the Sb3 ShopBot Software.

## Documentation
Currently the only available documentation is this README and the "CommandRef" PDF that is found under Help. This documentation describes the usage of all the OpenSBP Commands. A "guide" specific to this app is coming soon that will highlight some of the limited changes to the syntax that were required for compatibility with FabMo features and the new low-level hardware for ShopBot running on FabMo. Documentation for the OpenSBP digital fab syntax is also available at opensbp.org ...

## When Building
The primary repository for Sb4 has become the /apps folder within /fabmo/dashboard/. The separate repository in Github will be archived. 
