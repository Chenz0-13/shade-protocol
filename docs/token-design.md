# Token design note

This is a design note. It is not a token, not a launch, and not legal advice. It needs legal review, an independent audit, and a multi-party ceremony before any launch. There is no token contract in this repository, and this note does not authorise deploying one.

The idea, if it is ever built, is a utility work token used to bond relayers and message attestors. A bond can be slashed when a fault is proven: a relayer that is shown to have submitted a proof the pool rejected, or an attestor that signed a teleport the source pool did not emit. The proof of the fault is the point. A governance vote is not a substitute for that proof.

Fee discounts can be checked in a circuit: the spender shows a note or a credential that reduces the public relayer fee, without revealing the rest of their activity. That circuit does not exist yet.

A later buyback-and-burn of fees is optional and is not part of this repository. There is no revenue share. Holding the token would not be a claim on protocol fees.

Do not treat this note as an offer of a security, a promise of value, or a commitment to ship a token.
