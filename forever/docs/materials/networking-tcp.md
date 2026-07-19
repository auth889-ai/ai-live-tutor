# How the Internet Moves Data: The Dhaka-to-London Message

## 1. One message, the whole stack

Ayesha sends a photo from her phone in Dhaka to her cousin in London. That single act
touches every layer of networking: addressing, packets, routing, reliability, congestion.
This course follows that one photo, and every number is one you could measure with a packet
sniffer.

## 2. Layers: divide the impossible problem

The photo's journey is split into layers, each solving one problem and trusting the layer
below. Application (the photo app) hands data to Transport (TCP, reliability) which hands
to Network (IP, addressing) which hands to Link (WiFi/Ethernet, the physical hop). Four
layers, four jobs. A message going DOWN the stack gains a header at each layer
(encapsulation); going UP, each header is read and stripped. Layering is why the app author
never thinks about radio waves.

## 3. Packets: why data is chopped up

The 3-megabyte photo is not sent as one blob. It is split into packets of about 1500 bytes
each — so 3000000 / 1500 = 2000 packets. Each travels independently, possibly by different
routes, and is reassembled in order at the far end. Small packets mean one lost piece costs
a 1500-byte resend, not a 3-megabyte restart, and many conversations share the wire fairly.

## 4. IP addressing and routing

Every device has an IP address; London's server might be 142.250.72.100. Ayesha's packet
does not know the full route — it only knows its next hop. Each router reads the
destination, consults its table, and forwards one hop closer, like asking directions at
each corner rather than memorizing the whole map. The photo's packets cross roughly 12–18
routers between Dhaka and London; `traceroute` prints them.

## 5. TCP's three-way handshake

Before any photo data flows, TCP opens a reliable connection in three messages:
SYN (Ayesha: "let's talk, my sequence starts at X"), SYN-ACK (London: "okay, and mine
starts at Y"), ACK (Ayesha: "got it"). Three packets, one round trip, and both sides now
agree on sequence numbers. Only then does data flow. This handshake is why TCP is
"reliable" where a bare packet is not — both ends are synchronized before byte one.

## 6. Reliability: acknowledgements and retransmission

TCP numbers every byte. The receiver ACKs what it got; anything unacknowledged after a
timeout is resent. If packet 1050 of 2000 is lost, only it is retransmitted — the rest are
buffered, waiting. This is the core trick: reliability built ON TOP of an unreliable network
by numbering and re-sending, not by a perfect wire.

## 7. The round-trip time and the speed-of-light floor

Dhaka to London is about 8000 kilometers. Light in fiber travels ~200000 kilometers per
second, so one-way latency is at least 8000 / 200000 = 0.04 seconds = 40 milliseconds, and
a round trip is at least 80 milliseconds — before any router delay. This is physics, not
congestion: no protocol beats the speed of light. It is why a chatty protocol that waits
for a reply every packet would crawl, and why TCP sends many packets before pausing for
ACKs.

## 8. Congestion control: the shared-road problem

The internet is a shared road; if everyone floods it, everyone jams. TCP starts slow and
speeds up: send a little, and if ACKs return cleanly, double the send rate each round trip
(2, 4, 8, 16 packets in flight) — until loss signals congestion, then halve. This
additive-increase, multiplicative-decrease dance is why the internet does not collapse
under load: every sender voluntarily backs off when the road fills.

## 9. The misconception that hides the design

"Data travels from sender to receiver as one continuous stream down one fixed path." Nearly
everything in that sentence is false. The photo is 2000 independent packets, possibly taking
different routes, arriving out of order, reassembled by sequence number, with lost pieces
resent — and TCP presents the ILLUSION of one ordered stream on top of that chaos. The
stream is a fiction the protocol maintains; the reality is packets and numbers. Watch a
capture and the illusion dissolves into the real machinery.

## 10. What the model leaves out

The layered model is a teaching idealization; real stacks blur layers for speed, middleboxes
rewrite headers, and NAT hides whole networks behind one address. The four-layer story is
the honest skeleton that makes the system thinkable — trusted for the structure it reveals,
and revised the moment you debug a real network.
