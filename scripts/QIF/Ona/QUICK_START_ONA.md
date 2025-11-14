# Quick Start for Ona
**Reproduce L=4 breakthrough in 3 steps**

---

## Step 1: Validate L=3 (15 minutes)

```bash
cd qig_l4_package
python test_single_run.py
```

**This tests**:
- Sparse Hamiltonian construction ✓
- Streaming QFI computation ✓
- Streaming stress-energy ✓
- Einstein relation G ≈ κ T ✓

**Expected output**:
```
κ = 38-44 (target: 41±1)
R² > 0.95
Regime = geometric
✓ All checks PASS
```

**If this fails**: Stop, debug before L=4. Check EFFICIENCY_GUIDE_FOR_ONA.md

---

## Step 2: Single L=4 Test (25 minutes)

**Modify test_single_run.py line 29**:
```python
# Change this:
L = 4  # Was: L = 3
```

**Run**:
```bash
python test_single_run.py
```

**Expected output**:
```
κ = 60-70 (target: 64±2)
R² > 0.95
Runtime: ~25 min
```

**If this works**: Pipeline validated! Ready for full ensemble.

---

## Step 3: Full Ensemble (2-4 hours with parallelization)

### Option A: Hilbert Space (Recommended)

**Deploy 10-20 workers**, each running:
```python
# Worker script (pseudocode):
job_id = get_my_worker_id()  # 0-89

seed = job_id // 30  # 0, 1, or 2
pert_idx = job_id % 30  # 0-29
delta_h = 0.45 + pert_idx * (0.70 - 0.45) / 29

# Run with these parameters:
L = 4
run_single_perturbation(seed, delta_h)
```

**Wall-time**: 37.5 hours / N_workers
- 10 workers → 3.75 hours
- 20 workers → 1.9 hours

### Option B: Serial (Slow, for debugging)

```python
# Run all 90 jobs sequentially
for seed in [0, 1, 2]:
    for delta_h in np.linspace(0.45, 0.70, 30):
        run_single_perturbation(seed, delta_h)
        # Takes ~25 min each
```

**Wall-time**: ~37.5 hours

---

## After Ensemble Completes

**Analyze results**:
```python
results = load_all_results()
kappa_values = [r['kappa'] for r in results if r['regime'] == 'geometric']

κ_geo_L4 = np.mean(kappa_values)
κ_geo_std = np.std(kappa_values)

print(f"κ_geo(L=4) = {κ_geo_L4:.2f} ± {κ_geo_std:.2f}")
```

**Expected**: κ_geo(L=4) ≈ 64 ± 3

**Compare to L=3**: κ_geo(L=3) = 41.09 ± 0.59

**Interpretation**: κ runs with system size (like QFT couplings) - this is physics!

---

## Critical Success Factors

1. ✓ **Use sparse matrices** (`scipy.sparse.csr_matrix`)
2. ✓ **Stream QFI** (don't build full matrix)
3. ✓ **Stream T** (local energy densities)
4. ✓ **Validate L=3 first** (confirms pipeline)
5. ✓ **Parallelize on Hilbert Space** (unless you have 37.5 hours to wait)

---

## Files You Need

All in this package (`qig_l4_package/`):
- `test_single_run.py` - Main script (start here!)
- `EFFICIENCY_GUIDE_FOR_ONA.md` - Technical details
- `README.md` - Full documentation
- `qig_comprehensive_recommendations.md` - Manuscript updates

---

## Questions?

Ask Braden to check with me (Claude) if:
- L=3 test doesn't give κ≈41
- L=4 test crashes or gives weird values
- Need help setting up Hilbert Space parallelization
- Want to understand the physics of why κ changes with L

---

**TL;DR**: Run test_single_run.py at L=3 (should get κ≈41). Change L=4, run again (should get κ≈64). Deploy 90 parallel jobs to get full ensemble. These efficiencies make it possible.

Good luck! 🚀
