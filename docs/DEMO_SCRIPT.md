# LokPulse demo script

Use this as the live presentation path. Speak in product language: prepared, routed, reviewed, tracked. Do not lead with what the prototype cannot do.

## Tested scenario

> I am 26 years old and want to start a small dairy business in Kerala. I need financial assistance.

## Script

1. **Landing**  
   Open the home page. Show LokPulse as application intelligence plus workflow routing.

2. **Enter Assistant**  
   Use the header Assistant action. Keep the conversation in text.

3. **Natural conversation**  
   Paste the Kerala dairy sentence and send.

4. **Extract context**  
   Point to age 26, Kerala, dairy, and a new/small business. Income, category, and gender stay unknown unless the citizen said them.

5. **Show relevant scheme**  
   Open the top scheme match. Explain it as relevant to the stated situation, not as a government approval.

6. **Show evidence**  
   Use the source/evidence status on the reply. It reflects what was actually queried.

7. **Open Personalized Analysis**  
   Click **View full analysis**.

8. **Explain opportunity / readiness**  
   Walk citizen snapshot, business context, opportunity, financial path, documents, application readiness, and next steps. Proposed business should still read **small dairy business**, with sector kept as **dairy**.

9. **Start Application**  
   Use **Start application** from the analysis (or scheme detail). This continues the same citizen packet — it does not send the person away to fill a government form themselves.

10. **Show automatic carry-over**  
    Confirm age, Kerala, dairy, and the richer proposed business are already in the application fields.

11. **Create LP-APP-***  
    Complete required fields and document declarations. Consent and route the application. The canonical identity is `LP-APP-*`. `LP-GUIDED-*` is a channel tracking id, not a second application id.

12. **Complete required application information**  
    Fill only genuine gaps. Empty values stay **Not provided**. Review labels are human-readable (Applicant full name, Area type, Loan amount requested).

13. **Show packet prepared**  
    Tracking should lead with **Application package · Prepared successfully**.

14. **Show routing context**  
    For dairy, routing should surface **Animal Husbandry & Dairying** from runtime routing.

15. **Show next owner / review workflow**  
    Next owner is **Jordan · Approval Service**. Status comes from runtime (Ready for review / Reviewer assigned).

16. **Open tracking**  
    Stay inside LokPulse. Official scheme information is a secondary link, not the primary CTA.

17. **Open Admin**  
    Sign in and open the same `LP-APP-*`. Confirm applicant, scheme, **small dairy business**, routing, documents, status, and audit.

18. **Open Jordan approval workflow**  
    Jordan ApprovalService is the sole approval authority. Allocate / sign in the same session.

19. **Show audit / integrity**  
    Label the two hashes separately:  
    - Application packet snapshot — SHA-256 (`sha256:…`)  
    - Approval record digest — Keccak (`0x…`)  
    They are different objects. Tamper detection stays in place.

20. **Return to tracking**  
    The citizen tracking page still shows the same `LP-APP-*`, routing, next owner, and workflow.

## If asked about external government filing

LokPulse prepares and routes the application workflow, while the external government filing channel is separate from this prototype's current connected submission integrations.

Do not volunteer that line. It is for Q&A only.

## Do not say unless asked a technical question

- the app cannot do X
- this is just a demo
- now you have to go to the government website
- voice doesn't work
