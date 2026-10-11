/**
 * Sample course content used for the seeded demo source.
 *
 * Written specifically for this prototype so there are no licensing questions
 * about redistributing someone else's lecture material. It is deliberately
 * phrased as a real lecture handout: enough prose that extraction, chunking,
 * topic modelling and retrieval all have something meaningful to chew on, and
 * it deliberately includes one off-topic trap (the "Quantum Chromodynamics"
 * aside) so the refusal path is demonstrable out of the box.
 */

export const SAMPLE_COURSE_TITLE = 'CS 241 — Systems Programming: Memory & Concurrency';

export const SAMPLE_COURSE_PARAGRAPHS: string[] = [
  'CS 241 — Systems Programming',
  '',
  'Lecture 7: Memory Management, Caching and Concurrency',
  '',
  'This handout accompanies Lecture 7. It covers the virtual memory subsystem, the cache hierarchy, and the concurrency primitives that the rest of the course builds on.',
  '',

  '1. THE VIRTUAL MEMORY SUBSYSTEM',
  '',
  'Every process sees its own contiguous address space, but the physical memory behind it is fragmented and finite. The virtual memory subsystem is the layer that reconciles those two facts. It provides three guarantees: isolation between processes, the illusion of a large contiguous space, and the ability to run programs larger than physical RAM.',
  '',
  'A virtual address is split into two fields by the MMU. On a 4 KiB page system with a 48-bit virtual address, the low 12 bits are the page offset and the upper 36 bits are the virtual page number. The MMU consults the page table to translate the virtual page number into a physical frame number, then concatenates the physical frame number with the offset to form the physical address.',
  '',
  'The page table itself is usually too large to keep resident, so modern systems use multi-level page tables. A four-level table on x86-64 means three of the four levels are only allocated when actually used. Programs with a small working set therefore pay a very small translation cost, because they never allocate the upper levels.',
  '',
  'The TLB (translation lookaside buffer) is a small fully-associative cache sitting in the MMU that holds recent virtual-to-physical translations. A TLB hit avoids the page table walk entirely, which is the single largest performance factor in pointer-chasing code. A TLB miss costs roughly an order of magnitude more than a cache hit, which is why working-set size matters more than raw instruction count in memory-bound workloads.',

  '2. PAGE FAULTS AND REPLACEMENT',
  '',
  'A page fault occurs when a translation is not valid in the page table. There are two very different kinds. A minor fault means the page is present in memory but the mapping is not yet established, for example after fork. A major fault means the page is not in memory at all and must be read from the backing store, which costs a disk or SSD access.',
  '',
  'When physical memory is exhausted, the kernel must evict a page. Replacement policy choices are effectively a bet about the workload. LRU evicts the least recently used page and is cheap to implement approximately with a clock hand, but it suffers badly from sequential scans that evict the entire working set and then immediately reload it. This thrashing pathology is why Linux moved away from strict LRU.',
  '',
  'The Clock or Second Chance algorithm approximates LRU by keeping a reference bit on each frame. On eviction the hand clears the reference bit and moves on; only a frame whose bit was already clear is actually evicted. This costs one extra pass in the worst case but resists the sequential-scan pathology.',
  '',

  '3. THE CACHE HIERARCHY',
  '',
  'Memory is organised as a hierarchy of caches between the CPU and main memory. The hierarchy exploits two properties: locality in time, meaning recently accessed addresses are likely to be accessed again, and locality in space, meaning addresses near a recent access are also likely.',
  '',
  'Cache line size trades transfer bandwidth against waste. A 64-byte line on a 64-byte-aligned address means an aligned 8-byte load pulls in 64 bytes, of which 56 are wasted. Larger lines help sequential workloads by amortising the tag lookup; smaller lines help random pointer chasing by reducing waste.',
  '',
  'Direct-mapped caches map each block to exactly one location. They are fast and simple but suffer conflict misses when two hot addresses map to the same set. Fully associative caches avoid conflict misses entirely but need a full associativity search on every lookup, which is why they are impractical for large caches.',
  '',
  'Set-associative caching is the practical compromise. A 4-way set-associative cache has 4 candidate locations per set, and the replacement decision is confined to those 4 ways. The associativity increases hit rate by reducing conflict misses while keeping the hardware search parallel and cheap. The optimal associativity for a given cache size is an empirical question; the usual answer is 4 to 8 ways.',

  '4. CONCURRENCY PRIMITIVES',
  '',
  'A data race occurs when two threads access the same memory location concurrently and at least one of the accesses is a write, with no ordering between them. Data races are the source of most difficult concurrency bugs because the observed behaviour is not reproducible.',
  '',
  'A mutex provides mutual exclusion. Only one thread may hold the lock at a time, so the critical section is serialised. The cost of acquiring a mutex is two atomic operations in the uncontended case, which is on the order of twenty nanoseconds. Under contention the cost rises sharply, so mutexes should protect the smallest possible critical section.',
  '',
  'A reader-writer lock allows many concurrent readers but only a single writer. This helps when reads dominate writes and the critical section is long, because readers no longer serialise against each other. It can hurt when writes are frequent, because the extra bookkeeping can make it slower than a plain mutex.',
  '',
  'An atomic operation provides per-location mutual exclusion without a lock. Atomics are lock-free in the uncontended case but require careful memory ordering to be correct across architectures. Sequential consistency is the easiest model to reason about but is the most expensive; relaxed ordering is fastest but requires explicit fences where ordering actually matters.',
  '',
  'Deadlock requires four conditions to hold simultaneously: mutual exclusion, hold and wait, no preemption, and circular wait. Breaking any one of them eliminates the deadlock. The most common practical technique is to impose a global lock ordering, which breaks circular wait by construction.',
  '',

  '5. SUMMARY',
  '',
  'The virtual memory subsystem provides isolation and the illusion of unlimited address space, implemented with multi-level page tables and accelerated by the TLB. The cache hierarchy exploits temporal and spatial locality, with set-associativity balancing hit rate against hardware cost. Concurrency primitives from mutexes to atomics each solve a different part of the data race problem, and choosing among them requires understanding whether contention is expected and where the critical section lies.',
  '',
  'Aside for discussion: the proton and gluon structure of quantum chromodynamics is unrelated to anything in this lecture and is included only to test whether the tutoring system correctly declines questions that its uploaded material does not cover.',
];

export const SAMPLE_QUESTIONS = [
  'What does the virtual memory subsystem provide?',
  'How does a multi-level page table reduce translation cost?',
  'What problem does the Clock replacement algorithm address?',
  'Why do large cache lines hurt random pointer chasing?',
  'What are the four conditions required for deadlock?',
];