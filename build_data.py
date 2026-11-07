#!/usr/bin/env python3
"""Build data.json for the tracker from local sources (CSV, job JSON, cover letters, email cache)."""
import csv, json, os, glob, subprocess, re, datetime
C='/workspace/canada'; OUT=os.path.join(C,'cloudflare')
rows=list(csv.DictReader(open(f'{C}/applications_tracker.csv',encoding='utf-8')))
jobs={}
for f in sorted(glob.glob(f'{C}/jobs_2026-*.json')):
    try:
        for j in json.load(open(f,encoding='utf-8')): jobs.setdefault(str(j.get('id')),j)
    except Exception as e: print('skip',f,e)
dirs={d.split('_')[0]:os.path.join(C,'applications',d) for d in os.listdir(f'{C}/applications') if os.path.isdir(os.path.join(C,'applications',d))}
def readtxt(p):
    try: return open(p,encoding='utf-8').read().strip()
    except Exception: return ''
def pdftext(p):
    if not p or not os.path.exists(p): return ''
    try: return subprocess.run(['pdftotext','-layout' if False else '-raw',p,'-'],capture_output=True,text=True,timeout=30).stdout.strip()
    except Exception: return ''
def cover(r):
    p=r.get('cover_letter_file','')
    d=dirs.get(r['job_id'])
    for cand in [p]+([os.path.join(d,x) for x in ('cover_letter.txt','cover_letter.md')] if d else []):
        if cand and cand.endswith(('.txt','.md')) and os.path.exists(cand): return readtxt(cand),cand
    if p.endswith('.pdf'):
        t=pdftext(p)
        if t: return t,p
    return '',''
def email(r):
    jid=r['job_id']; ef=f'{OUT}/emails/{jid}.json'
    if os.path.exists(ef):
        e=json.load(open(ef,encoding='utf-8')); return e
    d=dirs.get(jid)
    if d and os.path.exists(f'{d}/email_body.txt'):
        e={'job_id':jid,'to':r.get('apply_email',''),'subject':readtxt(f'{d}/subject.txt') or r.get('email_subject',''),
           'body':readtxt(f'{d}/email_body.txt'),'source':'local email_body.txt (draft text as generated)','gmail_draft_id':r.get('gmail_draft_id','')}
        json.dump(e,open(ef,'w',encoding='utf-8'),ensure_ascii=False,indent=1); return e
    return None
import hashlib
FILES={}
def finfo(p,kind):
    if not p or not os.path.exists(p): return None
    b=open(p,'rb').read(); h=hashlib.sha256(b).hexdigest()[:32]
    FILES[h]=p
    return {'kind':kind,'name':os.path.basename(p),'hash':h,'size':len(b)}
def segs(n): return [x.strip() for x in (n or '').split('|') if x.strip()]
def skip_reason(n):
    ss=segs(n)
    for x in ss:
        if x.lower().startswith('excluded by'): return x
    ss=[x for x in ss if not x.startswith('Dedup rule') and not x.startswith('CV')]
    return ss[0] if ss else ''
def noemail_how(n):
    for x in segs(n):
        if x.lower().startswith('no email'): return re.sub(r'^no email\s*[–-]\s*','',x,flags=re.I)
    return ''
out=[]
for r in rows:
    j=jobs.get(r['job_id'],{})
    e=email(r) if r.get('gmail_draft_id') or r['status']=='sent' else None
    cl,clp=cover(r) if r.get('cover_letter_file') else ('','')
    g=lambda k:(j.get(k) or '')
    out.append({**{k:r.get(k,'') for k in ('job_id','title','company','city','province','noc','wage','lmia_status','open_to_international','source_url','apply_email','language','email_subject','gmail_draft_id','status','date_drafted','date_sent','send_batch','notes')},
        'closing_date':r.get('closing_date') or g('closing_date'),
        'work_mode':g('work_mode'),'employment_type':g('employment_type'),'requirements':g('requirements'),
        'date_found':g('date_found'),'date_posted':g('date_posted'),'apply_method':g('apply_method'),
        'francophone_mobility':g('francophone_mobility_eligible'),'occupation':g('occupation'),'start_date':g('start_date'),
        'screening_questions':g('screening_questions'),'fit_notes':g('fit_notes'),'who_can_apply':g('who_can_apply'),
        'files':[f for f in (finfo(r.get('cv_file',''),'CV'),finfo(r.get('cover_letter_file',''),'Cover letter')) if f],
        'skip_reason':skip_reason(r.get('notes','')) if r['status']=='skipped' else '',
        'no_email_how':noemail_how(r.get('notes','')) if r['status']=='no_email' else '',
        'email':e,'cover_letter':cl,'cover_letter_file':clp})
meta={'generated':datetime.datetime.now().astimezone().isoformat(timespec='minutes'),'count':len(out)}
json.dump(FILES,open(f'{OUT}/site/files.json','w'),indent=0)
json.dump({'meta':meta,'jobs':out},open(f'{OUT}/site/data.json','w',encoding='utf-8'),ensure_ascii=False)
print('jobs',len(out),'with email',sum(1 for x in out if x['email']),'with cover',sum(1 for x in out if x['cover_letter']))
# List what the email cache is missing so an agent with the Gmail connector can refresh it (see README.md)
need=[]
for r in rows:
    ef=f'{OUT}/emails/{r["job_id"]}.json'
    e=json.load(open(ef,encoding='utf-8')) if os.path.exists(ef) else None
    if r['status']=='sent' and (not e or e.get('source')!='gmail sent message'):
        need.append(f'{r["job_id"]}\tsent\tsearch_emails query: in:sent to:{r["apply_email"]}  -> read_email <id>\t{r["email_subject"]}')
    elif r['status']=='draft_saved' and r.get('gmail_draft_id') and (not e or not e.get('source','').startswith('gmail')):
        need.append(f'{r["job_id"]}\tdraft\tget_draft {r["gmail_draft_id"]}\t{r["email_subject"]}')
open(f'{OUT}/emails/NEEDS_FETCH.tsv','w',encoding='utf-8').write('job_id\tkind\tgmail call\tsubject\n'+'\n'.join(need)+('\n' if need else ''))
print('email cache: %d job(s) could be refreshed from Gmail -> emails/NEEDS_FETCH.tsv'%len(need))
