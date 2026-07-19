# Motion, Force, and Energy: The Dhaka Highway Problem

## 1. One situation, all of mechanics

A bus travels the Dhaka–Chattogram highway. Everything in this course — velocity,
acceleration, braking distance, force, energy — comes from this one bus and its numbers.
Predict first, compute second, believe the computation.

## 2. Velocity: the rate position changes

The bus covers 240 kilometers in 4 hours, so its average speed is 240 / 4 = 60 kilometers
per hour. In SI units that Is 60 × 1000 / 3600 = 16.67 meters per second. Velocity adds
direction to speed: 60 km/h TOWARD Chattogram.

Instantaneous velocity is what the speedometer shows at one moment. Average velocity over
a whole trip hides the story: the bus may have done 90 km/h on open road and 20 km/h in
traffic and still average 60.

## 3. Acceleration: the rate velocity changes

Leaving a toll plaza, the bus speeds up from 0 to 20 meters per second in 10 seconds.
Acceleration = (20 - 0) / 10 = 2 meters per second squared. Each second, the velocity
grows by 2 m/s: after 1 s it moves at 2 m/s, after 5 s at 10 m/s, after 10 s at 20 m/s.

Deceleration is just negative acceleration. Braking from 20 m/s to rest in 5 seconds is
an acceleration of (0 - 20) / 5 = -4 meters per second squared.

## 4. The braking distance — the equation that saves lives

With constant acceleration, distance = v₀t + ½at². Braking from 20 m/s at -4 m/s² takes
5 seconds and covers: 20 × 5 + 0.5 × (-4) × 25 = 100 - 50 = 50 meters.

The shortcut when you know speeds but not time: v² = v₀² + 2as. From 20 m/s to rest:
0 = 400 + 2 × (-4) × s, so s = 400 / 8 = 50 meters. Same answer, two routes — a
computation you can check both ways is a computation you can trust.

THE QUADRATIC TRAP: double the speed and the braking distance QUADRUPLES. From 40 m/s
with the same brakes: s = 1600 / 8 = 200 meters. Speed doubled from 20 to 40; distance
went from 50 to 200. This is why highway speed limits exist: the danger grows with the
SQUARE of the speed, not linearly.

## 5. Force: Newton's second law

The bus has a mass of 8000 kilograms. To decelerate it at 4 m/s², the brakes must supply
a force of F = ma = 8000 × 4 = 32000 newtons. A loaded bus of 12000 kilograms needs
12000 × 4 = 48000 newtons for the same stop — half again the force, or the same brakes
stop it more slowly.

Newton's first law is the special case F = 0: no net force, no change in velocity. The
bus cruising at a steady 60 km/h has ZERO net force on it — engine thrust exactly cancels
friction and drag. Constant velocity does not require force; CHANGING velocity does.

## 6. Kinetic energy and the work of stopping

Kinetic energy = ½mv². The 8000 kg bus at 20 m/s carries ½ × 8000 × 400 = 1600000 joules.
At 40 m/s it carries ½ × 8000 × 1600 = 6400000 joules — four times the energy at double
the speed, the same quadratic law wearing a different shirt.

Stopping means the brakes must absorb ALL of that energy as heat. Work = force × distance:
32000 newtons × 50 meters = 1600000 joules — exactly the kinetic energy. The books
balance. Energy is never lost, only moved: from motion, into hot brake discs.

## 7. Momentum and why collisions are brutal

Momentum = mass × velocity. The 8000 kg bus at 20 m/s carries 160000 kilogram-meters per
second. In a collision lasting 0.5 seconds, stopping that momentum needs an average force
of 160000 / 0.5 = 320000 newtons — TEN TIMES the braking force, applied to bodies and
steel instead of brake discs. Crumple zones work by stretching the collision time: the
same momentum change spread over 1.5 seconds needs only 160000 / 1.5 = 106667 newtons.
Softer stop, same physics.

## 8. The misconception that will not die

"A moving object needs a constant force to keep moving." Aristotle believed it; most
students still do. It FEELS true because friction is everywhere on Earth. But watch the
numbers: at constant 60 km/h the net force is zero (Section 5). The engine's force is not
"keeping it moving" — it is canceling friction. Remove all friction and the bus would
cruise forever with the engine off. Force changes motion; it does not sustain it.

## 9. Predict before you compute

Every problem in this course follows Mazur's discipline: commit to a prediction, then
compute, then reconcile. Will doubling the mass double the braking distance? Predict...
now compute: s = v²/(2a), and a = F/m, so s = v²m/(2F) — YES, at the same brake force,
doubling mass doubles distance. Your intuition said the heavier bus is harder to stop;
the algebra says exactly how much: linearly in mass, quadratically in speed.

## 10. What a model leaves out

Constant-acceleration formulas assume the brake force never fades, the road is level, and
tires never skid. Real braking involves heat fade, load transfer, and reaction time — the
50 meters is a floor, not a promise. A model is trusted for what it isolates, and
respected for what it admits leaving out.
