# Sales, Devblog, and Community Plan: Level Generator Plugin

**Owner:** Gemini (Marketing, Outreach & Multimodal Specialist)  
**Project:** Random Level Generator Plugin (Unreal Engine 5 & Unity)  
**Status:** Roadmap Round 1 Draft  
**Target File:** `docs/roadmap/40-sales-devblog-social.md`

---

## 1. Sales Strategy: Where and How It Sells

Our goal is to reach game developers directly inside the tools they use every day, while keeping a direct sales option with zero marketplace cut.

### Storefronts
1. **Fab (Epic Games Marketplace for Unreal Engine 5)**
   - **Why:** The primary destination for all UE5 creators.
   - **Platform Cut:** Epic historically offers an 88/12 revenue split (creator keeps 88%) `[to verify for new Fab store tiers]`.
   - **Submission Requirements:** Clean C++ and Blueprint project, sample demonstration map, no copyrighted meshes, and support for the current engine release (UE 5.4/5.5) `[to verify exact Fab technical checklist]`.
2. **Unity Asset Store**
   - **Why:** Massive indie and mobile developer market looking for procedural generation solutions.
   - **Platform Cut:** Historically a 70/30 revenue split (creator keeps 70%) `[to verify current Unity store agreement]`.
   - **Submission Requirements:** Unity package (`.unitypackage`), C# source code, demo scene, zero console errors on import.
3. **Direct Sales / Studio Site (via EDEN / Gumroad / Itch.io)**
   - **Why:** Maximum profit margin (~90-97% kept) and direct relationship with buyers.
   - **Approach:** Sell a unified "All-Engine Bundle" (UE5 + Unity licenses together) that is not offered on the individual engine stores.

### Pricing Approach & Testing
- **Market Price Range:** Procedural dungeon and level generators typically retail between **$35 and $75** depending on depth and visual polish `[to verify by benchmarking top 5 current store sellers]`.
- **Introductory Launch Offer:** Launch with a **20% discount for the first 14 days** to trigger marketplace "New & Trending" algorithm placements.
- **Dual-Engine Bundle Discount:** If bought through our own site, price the combined UE5 + Unity license at roughly 1.5x of a single-engine store price (giving developers who switch engines a clear bargain).
- **Testing the Price:** Run a brief private survey with 10-15 indie game developers during the beta phase to confirm perceived value before setting the public sticker price.

### Store Page Checklist
A store listing must answer "Can this save me two months of work?" within 5 seconds:
- **Hero Banner:** 1920x1080 sharp visual showing procedural levels generated in real time.
- **Trailer Video:** Under 90 seconds showing one-click generation and customization.
- **5 to 8 Annotated Screenshots:** Highlighting the Editor UI, seed reproducibility, modular mesh snapping, and performance stats.
- **Interactive Web / Playable Demo:** A lightweight WebGL or WebXR build showing the algorithm generating dungeons in real time in the browser.
- **Documentation:** A 1-page "5-minute Quickstart" PDF plus complete online API docs.

---

## 2. Weekly Owner Dashboard: Tracking in EDEN

The owner should not have to log into three different store dashboards and two analytics sites to know how the project is doing. Everything surfaces in **Project EDEN's Dashboard** every Monday.

### The 4 Weekly Metrics
1. **Build & Roadmap Progress:**
   - How many roadmap blocks moved from *Building* to *Done* this week.
   - Current open bug count and test pass rate.
   - Data source: EDEN Roadmap and GitHub issue state.
2. **Sales & Gross Revenue:**
   - Units sold across Fab, Unity Asset Store, and direct sales.
   - Net payout estimate after store cuts.
   - Data source: Weekly manual entry or lightweight automated store scraper `[to verify store API access]`.
3. **Ratings & Review Sentiment:**
   - Average star rating per store.
   - Flagging any 1-star or 3-star review immediately for owner attention.
   - Data source: Marketplace notification emails or store page watch script.
4. **Support Load & Issue Health:**
   - Number of support requests opened vs. closed.
   - Common pain points (e.g., "Install failed on UE 5.4.2" or "Colliders missing in Unity 2023").
   - Data source: EDEN Card queue under a "Support" workstream.

---

## 3. Devblog: The "AI Swarm Builds a Plugin" Story

Devblogs build an audience before launch. Instead of generic marketing, our hook is unique and transparent: **"An independent game studio using an AI swarm (Claude, Codex, and Gemini) to design, code, and ship a cross-engine level generator."**

### Cadence
- **Frequency:** One post every two weeks (bi-weekly) during development; weekly during the month leading up to launch.
- **Length:** 600 to 1,000 words with 2-3 GIFs or screenshots.

### First 6 Real-Build Post Topics
1. **Post 1: The Blueprint:** Why we are building a unified level generator for both Unreal and Unity—and how we coordinate three AI agents to do it.
2. **Post 2: One Math Core, Two Engines:** Designing the shared algorithm (seeds, rooms, corridors) so a level generated in Unity matches a level in Unreal.
3. **Post 3: AI Code Review in Practice:** What happened when Gemini and ChatGPT stress-tested Claude's code updates (real bugs found and solved).
4. **Post 4: Fighting the Viewport:** Building intuitive native editor UI in Unreal Slate/Blueprints versus Unity UI Toolkit.
5. **Post 5: The 10,000 Seed Stress Test:** Pushing performance limits—ensuring dungeon generation finishes in under 50 milliseconds with zero memory leaks.
6. **Post 6: Marketplace Launch Day:** Navigating Fab and Unity Asset Store reviews, pricing decisions, and releasing our first dev tool.

### Auto-Drafting from EDEN
- EDEN's **Trail tab** records every completed AI card, timing, debrief, and diff.
- A single EDEN command (**"Draft Devblog Post"**) gathers the last two weeks of completed Trail items, summarizes key milestones, and drafts a markdown post into `C:\AZI\NOTES_26\devlog\`.
- The owner reviews the draft, adjusts the tone, and clicks Publish.

---

## 4. Social Media & Developer Outreach

Solo developers cannot manage five social networks. We focus on two primary discovery channels plus one community hub.

### The 3 Core Channels
1. **YouTube (Long-term Discovery & Search):**
   - **Format:** 3 to 5 minute tutorial videos ("How to generate infinite procedural dungeons in UE5 in 60 seconds") and devlogs.
   - **Why:** Game developers search YouTube when solving specific problems. These videos generate sales for years.
2. **X / Twitter (Gamedev Community & Visual Hype):**
   - **Format:** 5 to 10 second looping MP4s/GIFs showing dramatic dungeon generation, seed changes, and lighting transitions (#gamedev, #UE5, #Unity3D).
   - **Why:** Short visual clips get shared quickly by indie developers and technical artists.
3. **Discord & Reddit (Community & Direct Feedback):**
   - **Format:** Helpful participation in `r/unrealengine`, `r/unity3d`, and a dedicated studio Discord server for bug reports, feature requests, and beta testing.
   - **Why:** Direct customer support builds loyalty and turns users into advocates.

### SWRMsync Link Hub
- A clean, single-link landing page (`azi.studio/swrm` or `devostater.github.io/swrm` `[to verify domain]`) that points to:
  - Fab Store page (UE5)
  - Unity Asset Store page
  - Documentation & Quickstart
  - Studio Discord / Support
  - Devblog

### Automation vs. Owner-in-the-Loop
| Task | Automated by EDEN / AI | Owner Hands-On Only |
| :--- | :--- | :--- |
| **Drafting Devblog Posts** | Summarizes Trail records into draft articles | Final review, personal anecdotes, publish click |
| **Social Media Snippets** | Generates 3 clip captions and hashtag sets per post | Reviewing and posting to X / Reddit |
| **Release Changelogs** | Gathers closed issues and commit summaries | Approving version number and release notes |
| **Community Replies** | Drafts suggested answers to technical questions | Sending responses on Discord/Reddit/Store reviews |
| **Financial / Account Actions** | *Never* | Payouts, tax info, store agreements, passwords |

---

## 5. Media Prototypes: Store Page & Trailer

As the multimodal specialist in the swarm, Gemini will design the visual storyboard and promotional concepts.

### 45-Second High-Impact Trailer Storyboard
- **0:00 - 0:05 (The Hook):** A dark, empty scene. One button press: a sprawling, fully textured dungeon snaps into existence in under 1 second.
- **0:06 - 0:18 (Engine Parity):** Split-screen showing Unreal Engine 5 on the left and Unity on the right generating the identical seed layout.
- **0:19 - 0:30 (Customization):** Quick cuts adjusting seed numbers, room density sliders, corridor width, and obstacle spawn rates in real time.
- **0:31 - 0:40 (Game Ready):** Dropping a player character into the generated level, showcasing navigation mesh (NavMesh) support, collisions, and dynamic lighting.
- **0:41 - 0:45 (Call to Action):** Clean title card with product logo, store links, and "Available now on Fab & Unity Asset Store".

### Visual Asset Needs
To generate promotional screenshots and trailer clips, the swarm will need:
- 1 basic modular dungeon kit (walls, floors, doorways, pillars) in FBX format `[to verify whether we use free CC0 assets or custom art]`.
- 1 basic sci-fi or urban tile kit to demonstrate genre versatility.
- 10 verified seed numbers that showcase visually diverse level layouts.

---

## 6. Owner Action Items & Approvals Checklist

The AI swarm handles the code, documentation, and asset preparation, but the following legal, financial, and publishing steps strictly require the owner:

### Accounts & Setup
- [ ] **Fab Publisher Registration:** Register and agree to Epic's publisher terms `[to verify current Fab tax interview requirements]`.
- [ ] **Unity Asset Store Publisher Portal:** Register and set up the Unity vendor account.
- [ ] **Banking & Payout Setup:** Enter tax identification and bank payout routing details directly in the secure store dashboards.

### Final Approvals Before Public Release
- [ ] **Price Confirmation:** Approve the final USD launch price and launch discount percentage.
- [ ] **Store Listing Review:** Inspect the store description, screenshots, and trailer before clicking Submit.
- [ ] **Release Build Approval:** Approve the final tested `.zip` / `.unitypackage` packages.
- [ ] **Public Social Posts:** Review and authorize any devblog post or promotional announcement before it goes live.
