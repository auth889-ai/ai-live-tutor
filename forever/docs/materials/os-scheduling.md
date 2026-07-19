# How an Operating System Runs Everything at Once: The Single-Cook Kitchen

## 1. One CPU, many demands

Rafiq's laptop has one CPU core but runs a browser, a music player, and a download all at
once. It cannot truly do three things simultaneously — it switches between them so fast the
illusion holds. This course is how the operating system creates that illusion: processes,
scheduling, context switches, and memory. Every number here is one a profiler could show.

## 2. The process: a program in motion

A program on disk is a recipe; a process is the cooking actually happening — the code plus
its live state (which line is executing, the values in memory, open files). The OS gives
each process the illusion of its own CPU and its own memory. Ten open tabs are ten
processes, each believing it owns the machine.

## 3. Context switching: the illusion's cost

To switch from the browser to the music player, the CPU saves the browser's entire state
(registers, program counter) and loads the player's. This context switch takes real time —
about 5 microseconds. If the OS switches 1000 times per second, that is
1000 × 5 = 5000 microseconds = 5 milliseconds per second, or 0.5 percent of the CPU spent
purely on switching. Switch too often and the machine spends all its time switching and
none cooking — the overhead is the price of the illusion.

## 4. Scheduling: who runs next

The scheduler decides which waiting process runs next. First-Come-First-Served is simplest:
run each to completion in arrival order. But if a 100-millisecond job arrives just before a
2-millisecond job, the short job waits 100 ms behind it — the "convoy effect," like one
huge cart blocking a queue of quick shoppers.

## 5. Round-robin: fairness by time slices

Round-robin gives each process a fixed time slice (say 10 ms), then switches to the next,
cycling around. Three processes each needing 30 ms finish in a fair interleave rather than
one hogging the CPU. Average waiting time drops sharply for mixed workloads. The trade-off:
a smaller slice is fairer but adds more context-switch overhead (Section 3); a larger slice
is efficient but less responsive. The slice size IS the fairness-versus-overhead dial.

## 6. Shortest-Job-First: the optimal that cheats

To minimize average waiting time, run the shortest job first. Four jobs of 8, 4, 2, 6 ms:
FCFS in that order gives waiting times 0, 8, 12, 14 — average 8.5 ms. Shortest-first
reorders to 2, 4, 6, 8, giving waiting times 0, 2, 6, 12 — average 5 ms. Provably optimal
for average wait. The catch: it requires knowing job lengths in advance, which the OS
usually cannot — so real schedulers ESTIMATE from past behavior. The optimal algorithm you
cannot quite run is still the target the practical ones approximate.

## 7. Virtual memory: the illusion of infinite RAM

Each process thinks it has a huge private memory. In reality the OS maps virtual addresses
to physical RAM in pages (typically 4 kilobytes each), keeping only the active pages in RAM
and the rest on disk. A 1-gigabyte process on a 256-megabyte machine works because only its
hot pages — say 250 megabytes — sit in RAM at once. Access a page that is on disk (a page
fault) and the OS fetches it, evicting a colder one. Memory is a cache illusion, just like
the CPU.

## 8. Deadlock: the standoff

Two processes each hold a resource the other needs and neither will let go — both freeze
forever. Process A holds the printer and wants the scanner; process B holds the scanner and
wants the printer. Four conditions must ALL hold for deadlock (mutual exclusion, hold-and-
wait, no preemption, circular wait); break any one and deadlock is impossible. The OS's job
is to prevent the circle, like a traffic rule that forbids the four-way gridlock.

## 9. The misconception that hides the machine

"The computer really does many things at the same time." On a single core, never — it does
ONE thing at a time and switches faster than you perceive, saving and restoring state each
time (Section 3). "Running at once" is time-slicing plus a fast switch, the same illusion as
a film's still frames becoming motion at 24 per second. See the context-switch count in a
profiler and the simultaneity dissolves into rapid taking-turns.

## 10. What the model leaves out

This single-core story omits real multicore parallelism, cache coherence, and interrupt
handling. Modern machines DO run several things truly at once across cores — but each core
still time-slices, so the illusion machinery is the foundation, not the whole building.
Trusted for the mechanism it exposes; extended the moment you profile a real system.
