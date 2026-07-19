# Finding Bugs Before Users Do: Testing the Clinic Booking System

## 1. One system, all of software testing

The clinic booking system from the requirements course now exists as code. Fatima must find
its bugs before patients do. Testing is not clicking around hoping — it is designing the
specific inputs most likely to break a stated expectation. We use Cem Kaner's BBST discipline
(Florida Tech, the scientific testing curriculum): every test has an ORACLE, and oracles are
fallible heuristics, not guarantees.

## 2. The oracle: how you know it failed

A test without an oracle is just exercise. The ORACLE is the principle by which you decide
pass or fail. For "the system shall confirm a booking within 2 seconds", the oracle is a
stopwatch and the 2-second bound. Every test names its oracle before it runs; "I clicked and
it looked fine" is not an oracle, it is an opinion. And every oracle is a HEURISTIC — a
stopwatch oracle misses a booking that confirms fast but reserves the wrong slot. Oracles are
useful and fallible; knowing their blind spots is the skill.

## 3. Equivalence partitioning: don't test every value

A booking accepts party sizes 1 to 10. You cannot test all inputs, but you do not need to:
inputs fall into EQUIVALENCE CLASSES that the code treats the same. Three classes here — too
low (0 and below), valid (1 to 10), too high (11 and above). One value from each class tests
the class. Testing 3, 4, 5, 6, 7 wastes effort; they are the same case. Testing 0, 5, and 11
covers all three behaviors with three tests.

## 4. Boundary value analysis: bugs live at the edges

Bugs cluster at boundaries, where a programmer wrote `<` instead of `<=`. So test the edges of
each partition, not just the middle. For the 1-to-10 range, the dangerous inputs are 0, 1, 10,
and 11 — one below the low bound, the low bound itself, the high bound, and one above. A
classic off-by-one bug accepts 0 or rejects 10; only boundary tests catch it. Middle values
like 5 never would.

## 5. Decision tables: combinations that interact

Some behavior depends on combinations. A booking is free IF the patient is a member AND it is
their first visit this month. Two conditions, four combinations: member+first (free),
member+repeat (paid), non-member+first (paid), non-member+repeat (paid). A decision table lays
out all four rows and their expected outcomes, so no combination is forgotten. Testing only
"member" and "first visit" separately misses that only their conjunction is free.

## 6. Happy path is the trap

The most dangerous assumption is testing only the HAPPY PATH — the booking that works. Real
bugs hide in the unhappy paths: double-booking the same slot, cancelling an already-cancelled
appointment, the payment succeeding but the confirmation email failing, two patients booking
the last slot simultaneously. A tester who only confirms the system works when used correctly
has tested almost nothing. Design tests for what users do WRONG and what happens CONCURRENTLY.

## 7. Exploratory testing: designing the next test from the last result

Scripted tests check what you already expected. EXPLORATORY testing designs the next test from
what the last one revealed — you notice the confirmation is slow under one condition, so you
vary that condition deliberately. It is not random clicking; it is simultaneous learning, test
design, and execution, following the evidence toward where bugs are likely. The best testers
alternate scripted coverage with exploratory hunting.

## 8. Severity vs priority

Not all bugs are equal, and two axes matter. SEVERITY is how bad the failure is (a crash is
severe; a typo is minor). PRIORITY is how urgently it must be fixed (a typo on the payment
button may be low-severity but high-priority because it scares users off). A rare crash in an
admin tool is high-severity, low-priority. Reporting both lets the team fix the right things
first; conflating them wastes effort on severe-but-irrelevant bugs.

## 9. The misconception that hides real risk

"If all the tests pass, the software has no bugs." Impossible to conclude. Passing tests show
only that the software works for the cases you thought to test — testing can prove the presence
of bugs, never their absence (Dijkstra's point). A green test suite that never tried concurrent
bookings says nothing about the concurrency bug waiting in production. Coverage is a measure of
what you CHECKED, not of what is CORRECT. The honest tester reports what was tested and what
was not, and never claims "bug-free."

## 10. What the model leaves out

These techniques find bugs efficiently but cannot guarantee completeness — the input space is
effectively infinite, and some failures emerge only from real load, real data, and real time.
Structured test design is the honest maximization of bugs-found-per-test; it is not proof of
correctness. A test suite is trusted for the failure modes it deliberately hunts, and respected
for stating the ones it did not reach.
