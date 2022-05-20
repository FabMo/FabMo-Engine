# /profiles
This is the profiles directory.  Profiles are collections of settings, macros and apps that can be applied to an engine installation to produce a sensible default state.  For an example of a profile see http://github.com/fabmo/fabmo-profile-dt 

This profiles directory holds all of the profiles for an installation.  All but the `default` subdirectory are deliberately ignored in git (except development exceptions), so that even when running the engine from source, profiles can be freely dropped into this location and be picked up by the engine.

For more information about profiles and how they work, see `profiles.js`