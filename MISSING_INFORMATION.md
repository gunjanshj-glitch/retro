# What I still need from you (Retro Holidays pricing)

Updated after your answers. Everything you answered is now in the calculator. This file lists only what is **still open**. Reply with the question number and your answer, for example `A: 70,000`.

## Words used in this file

| Term | Meaning |
|---|---|
| **Advertised price** | The "from ₹X per person" price shown for a ready-made package on the website and in the app. |
| **Our quote** | What our calculator produces for the same trip: 3-star hotel, cheapest month, land only (no flights), at the group size you told me (or a couple where you did not). |
| **Under** | Our quote is **lower** than the advertised price. A customer who builds the same trip themselves is shown a cheaper price than the package. |
| **Package floor** | When a customer picks the ready-made package itself, the quote is never allowed to fall below the advertised price. It does **not** protect trips customers build themselves. |
| **Land only** | Hotels, transfers, vehicle, sightseeing, meals. Not air tickets. |

## What I did with your answers

| Your answer | What changed |
|---|---|
| Hong Kong & Macau is land only; rates are high because of business demand and costly tours and transfers | Hotel, transfer and tour rates for Hong Kong and Macau raised to the maximum I allow (2.5 times). Our quote moved from 38% under to 15% under. It is a **fitted** number, not a real rate (see A below). |
| Kailash table | Package marked as **including the flight**. A named line "Tibet permits, group visa and guide" of ₹73,500 per person (₹3,500 + ₹70,000) is now added to any trip that includes Lake Mansarovar or Darchen. Kailash now quotes **16% over** the advertised ₹1,60,000 (was 52% under). |
| India packages are group quotes with all meals | Compared at the group size in your data and with all meals for Lakshadweep, Uttarakhand Pilgrimage, Great Uttarakhand Outdoors, Meghalaya, Arunachal Pradesh, Assam and Kashmir Off Beat. Assam and Kashmir Off Beat now match. Others still have a gap (see B). I did **not** invent permit or ferry amounts. |
| Gujarat, Kerala, Kashmir Delights, West Bengal, Punjab are 10 to 13 people | Compared at any size from 10 to 13. Gujarat matches (+0.2%). The other four are 7% to 19% under, so their group price is a little lower than our calculation. |
| Great Uttarakhand Outdoors is 6 nights, 7 days | Set to 6 nights. Compared with all meals at 8 people (your data says "minimum 8 people"). Now 15% under. |
| Maharashtra ₹75,000 | Corrected from ₹5,00,000 to ₹75,000. |
| Airfares from Kolkata | Thailand 30,000; Singapore 45,000; Malaysia 28,000; UAE 50,000; Turkey 70,000; Europe and UK 80,000; Japan 1,20,000; Bali 45,000; Sri Lanka 30,000. A full-service economy ticket from Kolkata now costs exactly that. Low-cost airlines and other cities stay cheaper or dearer in proportion. Vietnam stays at ₹59,000. |
| New mobile build: Yes | See Question C. |

---

## Question A. Hong Kong & Macau: real prices (still 15% under)

I used the highest uplift I allow and still sit 15% under ₹1,22,000. The remaining gap needs real numbers.

Fill in per person, for 2 adults sharing, 3-star hotel:

| Item | Your figure (₹) |
|---|---|
| Hotel, per room per night (low season) | |
| Hotel, per room per night (busy season) | |
| Airport pick-up or drop, per person | |
| Hong Kong to Macau ferry, per person | |
| Typical full-day tour, per person | |

If you cannot, answer **leave it**; the package floor still protects the ready-made package.

**Your answer to A:** _______

---

## Question B. India packages where we are still under

These are the gaps left after using your group size and all meals. You said permits, ferries and boats are included in the advertised price, so the gap is probably those. I need the amounts; I will not guess them.

| Package | Advertised ₹ | Our quote ₹ | Under by | Group size I used |
|---|---|---|---|---|
| Lakshadweep | 40,000 | 22,553 | 44% | 10 (from your data) |
| Uttarakhand Pilgrimage | 55,000 | 38,603 | 30% | 4 (from your data) |
| Great Uttarakhand Outdoors | 35,000 | 29,765 | 15% | 8 (from your data) |
| Arunachal Pradesh | 66,000 | 56,750 | 14% | a couple (**not known**) |
| Meghalaya | 45,000 | 39,423 | 12% | a couple (**not known**) |
| Kashmir Delights | 32,000 | 26,049 | 19% | 10 to 13 |
| West Bengal | 70,000 | 56,388 | 19% | 10 to 13 |
| Punjab | 30,000 | 25,267 | 16% | 10 to 13 |
| Maharashtra | 75,000 | 58,905 | 21% | a couple (**not known**) |

For each package you want closed, tell me per person:

| Package | Permits (inner line, forest, entry) ₹ | Boat, ferry, local flight ₹ | Other fixed charge and what it is |
|---|---|---|---|
| Lakshadweep | | | |
| Uttarakhand Pilgrimage | | | |
| Great Uttarakhand Outdoors (trek fee, guide, equipment) | | | |
| Arunachal Pradesh | | | |
| Meghalaya | | | |
| Maharashtra | | | |

Also: **how many people** is the advertised price based on for Arunachal Pradesh, Meghalaya, Assam, Kashmir Off Beat and Maharashtra? (A number, or "couple".)

**Your answer to B:** _______

---

## Question C. Mobile app build (only you can do this)

Your answer was yes. The phone app contains its own copy of the calculator, so it needs a new build for the vehicle table, the Kailash permit line, the airfares and the Hong Kong uplift. I cannot run it: it needs your Expo and Apple accounts, and this repository has no `eas.json` yet. On your computer:

```
cd mobile
npm install
npx eas-cli login
npx eas-cli build:configure     # creates eas.json, once
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios
```

Tell me if you want me to create `eas.json` first.

**Your answer to C:** _______

---

## Smaller open items (answer only if you want them closed)

| Item | Question |
|---|---|
| Kailash hotels | You wrote ₹26,000 for "Hotel/guest-house nights in Tibet (price per night)". Is that ₹26,000 **per night** or the **total** for all nights? I treated it as the total and did not use it. |
| Kailash yak, porter, pony | Marked "not included". What does it cost per person, so a trip can add it as an option? |
| Other airfares | Hong Kong, Nepal, Bhutan, Maldives, Australia, Dubai to Africa and others still use the rate-card fare. Give typical return economy fares from Kolkata if you want them set. |
