# Vectors, Matrices, and Transformations: The Delivery Fleet Problem

## 1. One business, all of linear algebra

Nadia runs a delivery service in Dhaka with two warehouses. Every day she must decide how
many packages each warehouse sends by bike and by van. Everything in this course — vectors,
matrices, linear combinations, transformations, determinants — is this one decision seen
from different angles. The 3Blue1Brown discipline applies throughout: picture first,
formula second, and every computation checked by executing it.

## 2. Vectors: quantities with structure

Warehouse A ships the vector [30, 20]: 30 packages by bike, 20 by van. Warehouse B ships
[10, 40]. A vector is not just a list — it is ONE object you can draw as an arrow: 30
steps along the bike axis, 20 along the van axis.

Adding vectors is combining shipments: [30, 20] + [10, 40] = [40, 60] — the fleet total,
40 by bike and 60 by van. Scaling is repetition: doubling warehouse A's shipment gives
2 × [30, 20] = [60, 40]. Those two operations — add and scale — are the WHOLE subject;
everything else is consequences.

## 3. Linear combinations and span

A linear combination weights and adds: c₁ × [30, 20] + c₂ × [10, 40]. With c₁ = 2 and
c₂ = 1: [60, 40] + [10, 40] = [70, 80]. The SPAN of the two warehouse vectors is every
total the fleet can possibly ship by choosing weights — here, all of 2D space, because
the two vectors point in genuinely different directions.

If warehouse B instead shipped [15, 10] — exactly half of A's [30, 20] — the two vectors
would be parallel, the span would collapse to a single line, and some delivery targets
would become impossible no matter the weights. Independence is capability.

## 4. Matrices: transformations, not tables

The city imposes a new routing rule: every shipment gets transformed. The matrix
M = [[2, 0], [0, 3]] doubles bike counts and triples van counts. Applying M to
warehouse A's [30, 20]: [2×30 + 0×20, 0×30 + 3×20] = [60, 60].

A matrix IS a function on vectors. Its columns tell you where the basis arrows land:
column 1 is [2, 0] (where "one bike package" goes), column 2 is [0, 3] (where "one van
package" goes). Read the columns and you know the whole transformation.

The rotation-like shear S = [[1, 1], [0, 1]] slides bike counts by van counts:
S applied to [30, 20] gives [1×30 + 1×20, 0×30 + 1×20] = [50, 20].

## 5. Matrix multiplication is composition

Apply the routing rule M first, then the shear S. The composed transformation is the
matrix product S × M = [[2, 3], [0, 3]] — computed column by column: M's first column
[2, 0] passes through S to give [2, 0]; M's second column [0, 3] passes through S to
give [3, 3]... wait, check it: S × [0, 3] = [1×0 + 1×3, 0×0 + 1×3] = [3, 3]. So
S × M = [[2, 3], [0, 3]].

Verify on warehouse A: M sends [30, 20] to [60, 60]; S sends [60, 60] to [120, 60].
Direct route: (S × M) applied to [30, 20] = [2×30 + 3×20, 0×30 + 3×20] = [120, 60].
Same answer both ways — composition IS multiplication, and the check is executable.

Order matters: M × S = [[2, 2], [0, 3]] — a different matrix, a different city rule.

## 6. The determinant: how areas scale

The determinant of M = [[2, 0], [0, 3]] is 2×3 - 0×0 = 6: the routing rule scales
areas by 6. A unit square of shipping options becomes a 2-by-3 rectangle, area 6.

The determinant of the parallel-warehouse setup [[30, 15], [20, 10]] is
30×10 - 15×20 = 300 - 300 = 0. Zero determinant means the transformation FLATTENS
2D space onto a line — exactly the collapsed span of Section 3. A zero determinant and
dependent columns and an unsolvable system are the SAME fact wearing three costumes.

## 7. Solving systems: the question in reverse

A client needs exactly [70, 80] delivered. What weights c₁, c₂ do it? That is the system:
30c₁ + 10c₂ = 70 and 20c₁ + 40c₂ = 80. From Section 3 we already know c₁ = 2, c₂ = 1
works: 30×2 + 10×1 = 70 and 20×2 + 40×1 = 80. Solving a system is asking which linear
combination of the columns hits the target — the picture and the algebra are one thing.

The determinant of the coefficient matrix [[30, 10], [20, 40]] is 30×40 - 10×20 = 1000.
Non-zero, so exactly one solution exists for ANY target — the fleet can hit every demand.

## 8. The misconception that wastes a year

"A matrix is a grid of numbers you memorize rules for." Wrong, and it makes every rule
feel arbitrary. A matrix is a TRANSFORMATION; the grid is just its address. Why is
multiplication row-by-column? Because that is what composing two transformations does to
the basis arrows (Section 5 verified it numerically). Why does a zero determinant kill
invertibility? Because you cannot un-flatten a line back into a plane (Section 6). The
rules stop being rules when you see what the object IS.

## 9. Predict, then compute

Before every worked step in this course, commit: will the shear S change warehouse A's
van count? Look at S's second row [0, 1]: van output = 0×bike + 1×van — prediction:
unchanged. Compute: S × [30, 20] = [50, 20]. Van count 20, unchanged. The prediction
habit converts formulas from spells into consequences.

## 10. What the model leaves out

Linear algebra assumes proportionality: doubling weights exactly doubles outcomes — no
bulk discounts, no van that fills up. Real logistics is nonlinear at the edges; the
linear model is the honest first approximation that makes the structure computable. Know
what it captures (structure, composition, capability) and what it forgets (saturation,
thresholds), and it will never lie to you.
