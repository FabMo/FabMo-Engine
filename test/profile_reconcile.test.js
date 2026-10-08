/*
 * Tests for the additive-only profile config reconcile (profile_reconcile.js).
 * Policy: an update may ADD new keys shipped by profiles; it must never
 * change or remove anything the machine already has.
 */
var reconcile = require("../profile_reconcile");

describe("additiveMerge", function () {
    test("adds keys the target lacks, at any depth", function () {
        var target = { a: 1, nest: { x: 1 } };
        var source = { a: 99, b: 2, nest: { x: 99, y: 3 }, deep: { c: { d: 4 } } };
        var added = reconcile._additiveMerge(target, source, "");
        expect(added.sort()).toEqual(["b", "deep", "nest.y"]);
        expect(target).toEqual({ a: 1, nest: { x: 1, y: 3 }, b: 2, deep: { c: { d: 4 } } });
    });

    test("never overwrites existing values, including falsy ones", function () {
        var target = { speed: 0, enabled: false, name: "", limit: null };
        var source = { speed: 5, enabled: true, name: "default", limit: 10 };
        var added = reconcile._additiveMerge(target, source, "");
        expect(added).toEqual([]);
        expect(target).toEqual({ speed: 0, enabled: false, name: "", limit: null });
    });

    test("treats arrays as atomic - no element merging, no overwrite", function () {
        var target = { list: [1, 2] };
        var source = { list: [1, 2, 3, 4], other: [9] };
        reconcile._additiveMerge(target, source, "");
        expect(target.list).toEqual([1, 2]);
        expect(target.other).toEqual([9]);
    });

    test("does not recurse into mismatched container types", function () {
        // User turned an object into a scalar (or vice versa): leave it.
        var target = { opt: 5 };
        var source = { opt: { mode: "auto" } };
        var added = reconcile._additiveMerge(target, source, "");
        expect(added).toEqual([]);
        expect(target.opt).toBe(5);
    });

    test("never deletes keys absent from the source", function () {
        var target = { user_added: true, kept: 1 };
        var source = { kept: 1 };
        reconcile._additiveMerge(target, source, "");
        expect(target.user_added).toBe(true);
    });
});

describe("overlayMerge", function () {
    test("profile overlay wins over default, recursively", function () {
        var merged = reconcile._overlayMerge(
            { a: 1, nest: { x: 1, y: 2 } },
            { nest: { y: 9, z: 3 }, b: 2 }
        );
        expect(merged).toEqual({ a: 1, nest: { x: 1, y: 9, z: 3 }, b: 2 });
    });

    test("does not mutate its inputs", function () {
        var base = { nest: { x: 1 } };
        var overlay = { nest: { y: 2 } };
        reconcile._overlayMerge(base, overlay);
        expect(base).toEqual({ nest: { x: 1 } });
        expect(overlay).toEqual({ nest: { y: 2 } });
    });
});
