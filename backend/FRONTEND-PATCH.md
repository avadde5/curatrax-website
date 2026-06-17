# Front-end wiring — exact edits for your HTML

Apply these **3 edits** to your website file. I verified the element IDs against your uploaded `curatrax_html.txt`, so these line up with your code (including your tweaks). Make a backup copy of the HTML first.

After deploying the Worker (see `README-CLOUDFLARE.md`), you'll have a URL like `https://curatrax-worker.YOUR-SUBDOMAIN.workers.dev`. Use it in Edit 1.

---

## Edit 1 — Add your backend URL (one line)

In the main `<script>` block, right **after** this helper line:

```javascript
  function $$(s,c){return Array.prototype.slice.call((c||doc).querySelectorAll(s))}
```

add:

```javascript
  var API_BASE = "https://curatrax-worker.YOUR-SUBDOMAIN.workers.dev"; // <-- replace with YOUR deployed backend URL (no trailing slash)
```

(One declaration, used by both the demo form and the waitlist below.)

---

## Edit 2 — Add a spam honeypot to the demo form

Find the demo submit button:

```html
        <button class="btn btn-primary mag" id="demoSubmit" type="button">Book my demo
```

Immediately **before** that `<button>` line, paste this hidden field:

```html
        <input type="text" id="cx_hp" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
```

Real visitors never see or fill it; bots do, and the backend silently drops those.

---

## Edit 3a — Replace the demo-form handler

Find this block (starts with the `Demo form` comment) and replace the **whole block** — from `var dBtn=...` down to its closing `}` — with the version below:

```javascript
  /* ---------- Demo form ---------- */
  var dBtn=$('#demoSubmit'), dCard=$('#demoCard');
  if(dBtn&&dCard){
    var fields=['dName','dEmail','dOrg'];
    dBtn.addEventListener('click',function(){
      var ok=true;
      fields.forEach(function(id){
        var f=doc.getElementById(id);
        if(!f) return;
        var v=f.value.trim();
        var bad=!v||(id==='dEmail'&&(v.indexOf('@')<1||v.length<5));
        f.style.borderColor=bad?'#F87171':'';
        if(bad) ok=false;
      });
      if(!ok) return;

      var hp=doc.getElementById('cx_hp');
      var roleEl=doc.getElementById('dRole');
      var payload={
        name:(doc.getElementById('dName')||{}).value.trim(),
        email:(doc.getElementById('dEmail')||{}).value.trim(),
        org:(doc.getElementById('dOrg')||{}).value.trim(),
        interest:roleEl?roleEl.value:'',
        company_website:hp?hp.value:''
      };

      var original=dBtn.innerHTML;
      dBtn.disabled=true; dBtn.style.opacity='.7'; dBtn.textContent='Sending…';

      fetch(API_BASE+'/api/demo',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      })
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {ok:r.ok&&j&&j.ok}; }); })
      .then(function(res){
        if(res.ok){ dCard.classList.add('sent'); }   // your existing success screen
        else { throw new Error(); }
      })
      .catch(function(){
        dBtn.disabled=false; dBtn.style.opacity=''; dBtn.innerHTML=original;
        alert("Sorry — something went wrong sending your request. Please email info@stelliteworks.com and we'll get right back to you.");
      });
    });
    fields.forEach(function(id){
      var f=doc.getElementById(id);
      if(f) f.addEventListener('input',function(){ f.style.borderColor=''; });
    });
  }
```

What changed: it still validates the same fields and still shows your `sent` success screen — but only **after** the backend confirms the email went out. On failure it re-enables the button and tells the visitor how to reach you.

---

## Edit 3b — Replace the waitlist handler

Find the `Credentialing waitlist` block and replace the **whole block** with:

```javascript
  /* ---------- Credentialing waitlist ---------- */
  var wBtn=$('#waitBtn'), wEmail=$('#waitEmail'), wForm=$('#waitForm');
  if(wBtn&&wEmail&&wForm){
    wBtn.addEventListener('click',function(){
      var v=wEmail.value.trim();
      if(v.indexOf('@')<1||v.length<5){
        wEmail.style.borderColor='#F87171';
        wEmail.focus();
        return;
      }
      wEmail.style.borderColor='';

      var original=wBtn.innerHTML;
      wBtn.disabled=true; wBtn.style.opacity='.7'; wBtn.textContent='Joining…';

      fetch(API_BASE+'/api/waitlist',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:v})
      })
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {ok:r.ok&&j&&j.ok}; }); })
      .then(function(res){
        if(res.ok){ if(wForm.parentElement) wForm.parentElement.classList.add('waited'); }
        else { throw new Error(); }
      })
      .catch(function(){
        wBtn.disabled=false; wBtn.style.opacity=''; wBtn.innerHTML=original;
        alert("Sorry — couldn't add you just now. Please email info@stelliteworks.com.");
      });
    });
    wEmail.addEventListener('input',function(){ wEmail.style.borderColor=''; });
  }
```

---

## Quick end-to-end test

1. Deploy the backend and set `API_BASE` to its URL.
2. Open your site, fill the demo form, submit.
3. The button shows "Sending…", then your "Request received" screen appears.
4. `info@stelliteworks.com` and `support@curatrax.com` get the lead; the visitor gets a confirmation.

If the success screen never appears, open browser dev tools → **Network** tab → submit again → click the `/api/demo` request to see the error (most often a CORS origin mismatch or a Zoho auth issue — both covered in `README-CLOUDFLARE.md` troubleshooting).
