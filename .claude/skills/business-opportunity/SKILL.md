---
name: business-opportunity
description: Size and judge a new audience, feature or partnership as a business before it is built - who pays, how many there are, what they pay elsewhere, what serving them costs, and how many paying users it takes to be worth it. Use when the owner asks "who else could we target", "is this worth building", "should this be paid", or proposes a new segment (drone pilots, owners and clubs, FBOs, mechanics, flight schools), and before adding a market to the business plan.
---

# Business opportunity

The owner is building a product people pay for, run on one small server by one person. An opportunity is worth building when enough people with the problem will pay more than they cost to serve, and when the app can reach them. Answer those three with numbers, not adjectives.

## 1. Name the customer and the job
One sentence each: who they are (a student pilot, a club treasurer, an FBO manager), the job they do, and what goes wrong today. Say whether the user and the payer are the same person: a flight school or a club pays for many users, an FBO pays for pilots to find it.

## 2. Count them, with sources and a date
- Pilots: the FAA's U.S. Civil Airmen Statistics (active pilots by certificate, instrument rating, remote pilots).
- Aircraft: the FAA's General Aviation and Part 135 Activity Survey.
- Businesses (FBOs, flight schools, clubs, repair stations): the FAA's own registries where they exist, then industry bodies (NATA, AOPA, EAA).
- Open the page each number comes from and link it. A number from memory is labelled "approximate" and checked before it goes into the business plan.
Then the share that is reachable: on an iPhone, in the US, doing this job at least monthly.

## 3. What they pay today
Run the `market-gap` skill for the job. Add each competitor's current price, from its own page, dated. A segment already paying $100 a year for a worse answer is a better opportunity than one used to free.

## 4. What serving them costs
- Fixed: the AWS design's monthly cost (`docs/README-AWS.md`, "What it costs") and the developer accounts.
- Per use: each Claude call at the model's current rate (the `claude-api` skill's pricing table), data licences, SMS or email, card and store fees (Apple and Google 15% under their small-business programs, 30% without).
- New work: the build, in the issues it would take, and anything that needs a partner or an approval (Leidos for filing, an FAA-approved USS for LAANC, a fuel-price feed).

## 5. Unit economics
Revenue kept per paying customer a year, less the cost to serve them; the break-even count against the fixed costs; and three scenarios (a first school or club, word of mouth, a known app) with the share of the segment each needs. A share above a few percent of the segment in year one is not a plan.

## 6. Decide
- **Build** when it pays back at a believable share and the app can reach the customer.
- **Bundle** when it is not worth selling alone but keeps a paying customer (mechanics through the owner's airplane records).
- **Free** when it spreads the app (enthusiasts, family following a flight) or keeps a pilot legal or safe - never paywall safety.
- **Partner** when someone else owns the data or the approval.
- **Skip**, saying why.

## Report
The customer and job, the count with sources and date, competitor prices, cost to serve, unit economics and break-even, the decision, and the smallest version worth shipping first. Add the result to the business plan doc when the owner keeps one (it lives in Claude Docs; ask for the link).
