import sys, pathlib
root = pathlib.Path(__file__).parent
src = root/'src'
css = (src/'styles.css').read_text()
js = '\n'.join((src/f).read_text() for f in ['engine.js','seed.js','ui-core.js','ui-shared.js','buyer-app.js','seller-app.js','shell.js'])
def page(react_tags):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fayda — working prototype (buyer and seller apps)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>
{css}
</style>
{react_tags}
</head>
<body>
<div id="root"></div>
<noscript>This prototype needs JavaScript.</noscript>
<script>
{js}
</script>
</body>
</html>
'''
cdn = '<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>\n<script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>'
local = '<script src="../vendor/react.js"></script>\n<script src="../vendor/react-dom.js"></script>'
(root/'dist'/'fayda-prototype.html').write_text(page(cdn))
(root/'dist'/'local.html').write_text(page(local))
print('built', len(page(cdn))//1024, 'KB')
