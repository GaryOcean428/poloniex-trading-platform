#!/usr/bin/env python3
"""
TEST SINGLE L=4 PERTURBATION
Run this FIRST to validate pipeline before scaling to full ensemble.

Expected: κ ≈ 35-45, R² > 0.95, ~10-20 min runtime
"""

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import eigsh
from scipy.stats import linregress
import json
import time
from pathlib import Path

print("=" * 80)
print("QIG L=4 SINGLE PERTURBATION TEST")
print("=" * 80)
print()

# ===========================================================================
# CONFIGURATION
# ===========================================================================

L = 4  # 4×4 lattice
N = L * L  # 16 sites
J = 1.0  # Ising coupling
h_base = 1.0  # Base transverse field
delta_h = 0.55  # Middle of geometric regime [0.45, 0.70]
epsilon = 1e-6  # QFI regularization

print(f"System: L={L} ({N} sites, Hilbert space dim={2**N})")
print(f"Perturbation: δh = {delta_h} (geometric regime)")
print()

# ===========================================================================
# HAMILTONIAN CONSTRUCTION (Sparse)
# ===========================================================================

print("Step 1: Building Hamiltonian...")
start = time.time()

# Pauli matrices
sx = sp.csr_matrix([[0, 1], [1, 0]], dtype=np.complex128)
sz = sp.csr_matrix([[1, 0], [0, -1]], dtype=np.complex128)
id2 = sp.csr_matrix([[1, 0], [0, 1]], dtype=np.complex128)

def site_to_coord(i, L):
    return (i // L, i % L)

def coord_to_site(x, y, L):
    return (x % L) * L + (y % L)

def get_neighbors(i, L):
    x, y = site_to_coord(i, L)
    return [
        coord_to_site(x+1, y, L),  # Right
        coord_to_site(x, y+1, L),  # Up
    ]

def build_operator(op_list, N):
    """Build N-site operator from list of single-site operators"""
    result = op_list[0]
    for op in op_list[1:]:
        result = sp.kron(result, op)
    return result

# Build H = -J ∑_<ij> Z_i Z_j - ∑_i (h + δh) X_i
dim = 2 ** N
H = sp.csr_matrix((dim, dim), dtype=np.complex128)

# ZZ interactions
print("  Adding ZZ interactions...")
for i in range(N):
    for j in get_neighbors(i, L):
        if i < j:  # Avoid double counting
            ops = [id2] * N
            ops[i] = sz
            ops[j] = sz
            H = H - J * build_operator(ops, N)

# X fields (with perturbation)
print("  Adding X fields...")
h_local = h_base + delta_h
for i in range(N):
    ops = [id2] * N
    ops[i] = sx
    H = H - h_local * build_operator(ops, N)

elapsed = time.time() - start
print(f"  ✓ Hamiltonian built (sparse, {H.nnz} non-zero elements, {elapsed:.1f}s)")
print()

# ===========================================================================
# GROUND STATE
# ===========================================================================

print("Step 2: Finding ground state...")
start = time.time()

E0, psi0 = eigsh(H, k=1, which='SA')
psi0 = psi0.flatten()
E0 = E0[0]

elapsed = time.time() - start
print(f"  ✓ Ground state found: E0 = {E0:.6f} ({elapsed:.1f}s)")
print()

# ===========================================================================
# QFI METRIC (Simplified for Test)
# ===========================================================================

print("Step 3: Computing QFI metric (finite differences)...")
start = time.time()

def perturb_and_solve(delta_params):
    """Solve H with perturbation"""
    H_pert = sp.csr_matrix((dim, dim), dtype=np.complex128)
    
    # ZZ terms (unchanged)
    for i in range(N):
        for j in get_neighbors(i, L):
            if i < j:
                ops = [id2] * N
                ops[i] = sz
                ops[j] = sz
                H_pert = H_pert - J * build_operator(ops, N)
    
    # X fields (with new perturbation)
    for i in range(N):
        h_i = h_base + delta_params[i]
        ops = [id2] * N
        ops[i] = sx
        H_pert = H_pert - h_i * build_operator(ops, N)
    
    _, psi = eigsh(H_pert, k=1, which='SA')
    return psi.flatten()

# Compute derivatives (sample 4 sites to save time in test)
print("  Computing derivatives for 4 representative sites...")
sample_sites = [0, 3, 12, 15]  # Corners
delta_fd = 1e-4
g = np.zeros((N, N))

psi_derivs = {}
for i in sample_sites:
    pert = np.ones(N) * delta_h
    pert[i] += delta_fd
    psi_plus = perturb_and_solve(pert)
    psi_derivs[i] = (psi_plus - psi0) / delta_fd

# Compute QFI for sampled sites
for i in sample_sites:
    for j in sample_sites:
        overlap = np.vdot(psi_derivs[i], psi_derivs[j])
        proj_i = np.vdot(psi_derivs[i], psi0)
        proj_j = np.vdot(psi_derivs[j], psi0)
        F_ij = 4 * np.real(overlap - proj_i * np.conj(proj_j))
        g[i, j] = F_ij

# Regularize
g += epsilon * np.eye(N)

elapsed = time.time() - start
print(f"  ✓ QFI metric computed (sampled, {elapsed:.1f}s)")
print()

# ===========================================================================
# DISCRETE GEOMETRY
# ===========================================================================

print("Step 4: Computing discrete curvature...")
start = time.time()

# Discrete Ricci: R_i ≈ mean(g_ij for neighbors) - g_ii
R_diag = np.zeros(N)
for i in range(N):
    neighbors = []
    x_i, y_i = site_to_coord(i, L)
    for x in range(L):
        for y in range(L):
            if 0 < (x - x_i)**2 + (y - y_i)**2 <= 2:  # Within distance √2
                neighbors.append(coord_to_site(x, y, L))
    
    if len(neighbors) > 0:
        R_diag[i] = np.mean([g[i, j] for j in neighbors]) - g[i, i]

R_scalar = np.sum(R_diag)

# Einstein tensor: G_ij = R_ij - (1/2) g_ij R
R_ij = np.diag(R_diag)
G_ij = R_ij - 0.5 * g * R_scalar

elapsed = time.time() - start
print(f"  ✓ Curvature computed: R = {R_scalar:.6f} ({elapsed:.1f}s)")
print()

# ===========================================================================
# STRESS-ENERGY TENSOR
# ===========================================================================

print("Step 5: Computing stress-energy tensor...")
start = time.time()

def local_energy_density(psi, site):
    """<H_site> at given site"""
    # X term
    ops = [id2] * N
    ops[site] = sx
    op_x = build_operator(ops, N)
    E_x = -h_local * np.real(np.vdot(psi, op_x @ psi))
    
    # ZZ terms (half from each bond)
    E_zz = 0.0
    for neighbor in get_neighbors(site, L):
        ops = [id2] * N
        ops[site] = sz
        ops[neighbor] = sz
        op_zz = build_operator(ops, N)
        E_zz += -0.5 * J * np.real(np.vdot(psi, op_zz @ psi))
    
    return E_x + E_zz

T_diag = np.array([local_energy_density(psi0, i) for i in range(N)])

elapsed = time.time() - start
print(f"  ✓ Stress-energy computed ({elapsed:.1f}s)")
print()

# ===========================================================================
# EINSTEIN RELATION: G_ij ≈ κ T_ij
# ===========================================================================

print("Step 6: Testing Einstein relation...")
start = time.time()

G_diag = np.diag(G_ij)

# Linear fit: G = κ T + b
slope, intercept, r_value, p_value, std_err = linregress(T_diag, G_diag)
kappa = slope
R_squared = r_value ** 2

residuals = G_diag - (kappa * T_diag + intercept)

elapsed = time.time() - start

print(f"  ✓ Einstein relation tested ({elapsed:.1f}s)")
print()
print("=" * 80)
print("RESULTS:")
print("=" * 80)
print(f"κ = {kappa:.2f} ± {std_err:.2f}")
print(f"R² = {R_squared:.4f}")
print(f"Intercept = {intercept:.4f}")
print(f"Residual RMS = {np.sqrt(np.mean(residuals**2)):.4f}")
print()

# ===========================================================================
# DIAGNOSTICS
# ===========================================================================

# Regime classification
avg_activation = abs(delta_h) / h_base
if avg_activation < 0.3:
    regime = "linear"
elif avg_activation < 0.7:
    regime = "geometric"
else:
    regime = "breakdown"

print("DIAGNOSTICS:")
print(f"  Regime: {regime}")
print(f"  Activation: {avg_activation:.2f}")
print(f"  Curvature mean: {np.mean(R_diag):.4f}")
print(f"  Curvature std: {np.std(R_diag):.4f}")
print(f"  Stress mean: {np.mean(T_diag):.4f}")
print(f"  Stress std: {np.std(T_diag):.4f}")
print()

# ===========================================================================
# VALIDATION
# ===========================================================================

print("=" * 80)
print("VALIDATION:")
print("=" * 80)

checks = {
    'κ in expected range (35-45)': 35 <= kappa <= 45,
    'R² > 0.95': R_squared > 0.95,
    'Regime = geometric': regime == 'geometric',
    'Curvature non-zero': np.max(np.abs(R_diag)) > 1e-6,
    'Stress non-zero': np.max(np.abs(T_diag)) > 1e-6,
}

all_pass = all(checks.values())

for check, passed in checks.items():
    status = "✓ PASS" if passed else "✗ FAIL"
    print(f"  {status}: {check}")

print()
if all_pass:
    print("🎉 ALL CHECKS PASSED - Pipeline validated!")
    print()
    print("Next step: Run full ensemble with:")
    print("  python run_ensemble.py --parallel --workers 10")
else:
    print("⚠️  SOME CHECKS FAILED - Debug before scaling")
    print()
    print("Possible issues:")
    if kappa < 35:
        print("  • κ too low: May be in linear regime (try larger δh)")
    if kappa > 45:
        print("  • κ too high: May be in breakdown regime (try smaller δh)")
    if R_squared < 0.95:
        print("  • Low R²: Check QFI computation, increase sample size")
    if regime != 'geometric':
        print(f"  • Wrong regime ({regime}): Adjust δh to [0.45, 0.70]")

print("=" * 80)

# ===========================================================================
# SAVE RESULTS
# ===========================================================================

output_dir = Path("./test_results")
output_dir.mkdir(exist_ok=True)

result = {
    'metadata': {
        'L': L,
        'N': N,
        'delta_h': delta_h,
        'regime': regime,
    },
    'physics': {
        'E0': float(E0),
        'kappa': float(kappa),
        'kappa_stderr': float(std_err),
        'R_squared': float(R_squared),
        'intercept': float(intercept),
    },
    'diagnostics': {
        'curvature_mean': float(np.mean(R_diag)),
        'curvature_std': float(np.std(R_diag)),
        'stress_mean': float(np.mean(T_diag)),
        'stress_std': float(np.std(T_diag)),
    },
    'validation': checks,
}

result_file = output_dir / "test_single_run.json"
with open(result_file, 'w') as f:
    json.dump(result, f, indent=2)

print(f"Results saved to: {result_file}")
print()
print("✨ Test complete! ✨")
