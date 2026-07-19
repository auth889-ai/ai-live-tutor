# Designing Systems That Scale: The Dhaka Ride-Hailing Backend

## 1. One system, all of architecture

Tania is building the backend for a ride-hailing app in Dhaka. Every architecture decision —
how to structure services, where the bottleneck is, which trade-off to accept — plays out in
this one system. We reason with back-of-envelope numbers first (ByteByteGo discipline), draw
at four zoom levels (Simon Brown's C4), and pick each component only when a stated bottleneck
forces it.

## 2. Back-of-the-envelope: numbers before boxes

Before drawing anything, estimate the load. The app has 1000000 users, 10 percent active
daily, each making 2 ride requests: that is 1000000 × 0.10 × 2 = 200000 requests per day.
Spread over a 12-hour active window (43200 seconds), that averages 200000 / 43200 ≈ 4.6
requests per second — but peak is 5× average, so design for about 23 requests per second.
These numbers decide everything downstream; a design that ignores them is decoration.

## 3. The C4 Context level

The coarsest view: the Ride-Hailing System sits as ONE box, surrounded by the people and
systems it talks to — Riders, Drivers, a Payment Gateway, and a Maps provider. No internals
yet. This level answers the non-technical stakeholder's question: what is this system and
who uses it. Four boxes, four arrows.

## 4. The C4 Container level

Zoom in one level: inside the system are separate deployable units — a Mobile App, an API
Gateway, a Ride-Matching Service, a Location Service, a Payment Service, and two data stores
(a PostgreSQL database for rides, a Redis cache for live driver locations). Each container is
a process you could deploy independently. This is the level most architecture conversations
actually happen at.

## 5. Stateless services and horizontal scaling

At 23 requests per second one server suffices, but growth to 230 requests per second needs
more. If the Ride-Matching Service is STATELESS (holds no session data between requests), you
scale it HORIZONTALLY: run 10 identical copies behind a load balancer, each handling ~23
requests per second. Statelessness is what makes this possible — any copy can handle any
request. A stateful service cannot be cloned this freely; that is why architects push state
DOWN into databases and caches and keep the compute layer stateless.

## 6. The database bottleneck and caching

Every ride request reads nearby driver locations. At 230 requests per second, if each hits
PostgreSQL, the database becomes the bottleneck — disk reads cap out around a few thousand
per second and latency climbs. The fix: a Redis cache holding live driver locations in
memory. Memory reads are roughly 100× faster than disk. If 90 percent of location reads hit
the cache, the database sees only 230 × 0.10 = 23 reads per second instead of 230 — a 10×
reduction that turns the bottleneck back into headroom. The cache is FORCED by the measured
read load, not added for fashion.

## 7. The ATAM trade-off: consistency vs availability

Caching driver locations introduces a trade-off. A cached location may be a few seconds
stale — a driver shown as "here" may have moved. That is a CONSISTENCY cost bought for an
AVAILABILITY and LATENCY gain. Is it acceptable? For driver locations, yes: a 3-second-old
position is fine for matching, and the alternative (querying the database every time) fails
under load. For PAYMENTS, no: there, stale data means double-charging, so payments read the
database directly and never cache. The same system makes OPPOSITE choices for different data
because the quality attribute at stake differs. Naming the attribute — consistency here,
availability there — is the architect's actual job.

## 8. Message queues: absorbing spikes

At peak, ride requests can burst to 5× average in seconds. If every burst hits the matching
service synchronously, it overloads. A message queue between the API Gateway and the matching
service absorbs the spike: requests are enqueued instantly and processed at a steady rate the
service can sustain. The queue trades a little LATENCY (requests wait briefly) for RESILIENCE
(no overload, no dropped requests). Again a named trade-off, chosen on purpose.

## 9. The misconception that sinks designs

"A more complex architecture — more services, more caches, more queues — is a better
architecture." The opposite is true. Every component you add is a bottleneck you must justify
with a number, plus new failure modes and operational cost. The best architecture is the
SIMPLEST one that meets the measured requirements. Start with one server and one database;
add a cache only when the read load proves you need it; add a queue only when spikes prove
it. Complexity is a cost you pay to solve a measured problem, never a virtue.

## 10. What the model leaves out

Back-of-envelope numbers assume uniform load and ignore network partitions, cascading
failures, and the human cost of operating many services. The four C4 levels are a
communication tool, not the running system. The estimates get you to a defensible starting
design; production teaches the rest. An architecture is trusted for the bottlenecks it
addresses with evidence, and respected for admitting what it has not yet been tested against.
