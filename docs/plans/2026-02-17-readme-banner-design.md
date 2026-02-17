# README Banner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a new GitHub README top banner SVG for KG Sidecar in minimal engineering style.

**Architecture:** Rebuild `assets/cover.svg` as a static vector composition: light gradient background, subtle grid, right-side graph topology, left-side product typography. Then embed the banner at the top of `README.md` using a relative image path.

**Tech Stack:** SVG 1.1, Markdown

---

### Task 1: Replace banner SVG

**Files:**
- Modify: `assets/cover.svg`

**Step 1: Write the failing test**
- Visual expectation before change: old dark banner with mismatched size and style.

**Step 2: Run test to verify it fails**
- Open `assets/cover.svg` and confirm it is not `1600x500` minimal engineering style.

**Step 3: Write minimal implementation**
- Set canvas to `1600x500`.
- Add light gradient, subtle grid, left title block, right graph cluster.
- Keep title as `KG Sidecar`.

**Step 4: Run test to verify it passes**
- Validate SVG syntax and ensure expected elements are present.

**Step 5: Commit**
- Commit banner replacement.

### Task 2: Attach banner to README

**Files:**
- Modify: `README.md`

**Step 1: Write the failing test**
- README has no top banner image.

**Step 2: Run test to verify it fails**
- Search README for `assets/cover.svg` and confirm no match.

**Step 3: Write minimal implementation**
- Add centered image block at file top:
  - `<img src="assets/cover.svg" ...>`

**Step 4: Run test to verify it passes**
- Search README and verify top banner reference exists.

**Step 5: Commit**
- Commit README banner embed.
