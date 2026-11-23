// Independent APNG compositing oracle following the APNG spec wording.
// Operates on RGBA8 logical canvases; used to validate UPNG.toRGBA8 output.
function newCanvas(w, h) { return new Uint8Array(w * h * 4); }

function over(s, b) {
	// s, b: 4-byte RGBA tuples; returns composited RGBA tuple
	var sa8 = s[3], ba8 = b[3];
	if(sa8 === 0) return b.slice();
	if(sa8 === 255 || ba8 === 0) return s.slice();
	// Mirror the implementation's exact 8-bit arithmetic (PNG spec 13.31: results floor).
	// Premultiply in byte space, then unpremultiply; every store truncates.
	var fa = sa8 / 255, ba = ba8 / 255;
	var fr = s[0]*fa, fg = s[1]*fa, fb = s[2]*fa;
	var br = b[0]*ba, bg = b[1]*ba, bb = b[2]*ba;
	var ifa = 1 - fa, oa = fa + ba*ifa, ioa = (oa === 0 ? 0 : 1/oa);
	return [
		Math.floor((fr + br*ifa) * ioa),
		Math.floor((fg + bg*ifa) * ioa),
		Math.floor((fb + bb*ifa) * ioa),
		Math.floor(255 * oa)
	];
}

// frames: [{rect:{x,y,width,height}, rgba:Uint8Array tile RGBA8, blend, dispose}]
function render(w, h, frames) {
	var canvas = newCanvas(w, h);
	var results = [];
	for(var i=0; i<frames.length; i++) {
		var fr = frames[i];
		var before = canvas.slice(0);
		for(var y=0; y<fr.rect.height; y++) {
			for(var x=0; x<fr.rect.width; x++) {
				var ti = ((fr.rect.y+y)*w + fr.rect.x+x)*4;
				var si = (y*fr.rect.width + x)*4;
				var s = [fr.rgba[si], fr.rgba[si+1], fr.rgba[si+2], fr.rgba[si+3]];
				var b = [canvas[ti], canvas[ti+1], canvas[ti+2], canvas[ti+3]];
				var r = fr.blend === 0 ? s.slice() : over(s, b);
				canvas[ti]=r[0]; canvas[ti+1]=r[1]; canvas[ti+2]=r[2]; canvas[ti+3]=r[3];
			}
		}
		results.push(canvas.slice(0));
		if(fr.dispose === 1) {
			for(var y2=0; y2<fr.rect.height; y2++)
				for(var x2=0; x2<fr.rect.width; x2++) {
					var k = ((fr.rect.y+y2)*w + fr.rect.x+x2)*4;
					canvas[k]=canvas[k+1]=canvas[k+2]=canvas[k+3]=0;
				}
		} else if(fr.dispose === 2) {
			for(var y3=0; y3<fr.rect.height; y3++)
				for(var x3=0; x3<fr.rect.width; x3++) {
					var k2 = ((fr.rect.y+y3)*w + fr.rect.x+x3)*4;
					canvas[k2]=before[k2]; canvas[k2+1]=before[k2+1];
					canvas[k2+2]=before[k2+2]; canvas[k2+3]=before[k2+3];
				}
		}
	}
	return results;
}

module.exports = { render: render, over: over, newCanvas: newCanvas };
