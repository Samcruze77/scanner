# Opens a file in headless LibreOffice (an independent Office-crypto implementation) and
# prints the document text, or the failure. usage: lo_open.py file [password]
import sys, time, subprocess, os, uno
from com.sun.star.beans import PropertyValue
f = os.path.abspath(sys.argv[1]); pw = sys.argv[2] if len(sys.argv) > 2 else None
port = 2002 + (os.getpid() % 500)
p = subprocess.Popen(["soffice","--headless","--invisible","--norestore",f"-env:UserInstallation=file:///tmp/lo_prof_{port}",f"--accept=socket,host=localhost,port={port};urp;"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    ctx = uno.getComponentContext()
    resolver = ctx.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", ctx)
    for _ in range(60):
        try: c = resolver.resolve(f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext"); break
        except Exception: time.sleep(1)
    desktop = c.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", c)
    def pv(n,v): x=PropertyValue(); x.Name=n; x.Value=v; return x
    props=[pv("Hidden",True)]
    if pw is not None: props.append(pv("Password",pw))
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(f), "_blank", 0, tuple(props))
    if doc is None: print("OPEN_FAILED"); 
    else:
        import json
        text = doc.getText().getString()
        summary = {"text": text, "tables": doc.getTextTables().getCount(), "images": doc.getGraphicObjects().getCount(), "sections": doc.getTextSections().getCount()}
        print("OPENED:", json.dumps(summary, ensure_ascii=False)); doc.close(True)
except Exception as e:
    import traceback; print("OPEN_FAILED", type(e).__name__, str(e)[:200])
finally:
    try: desktop.terminate()
    except Exception: pass
    p.terminate()
