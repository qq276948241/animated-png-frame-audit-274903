// Minimal offline PNG/APNG reference builder.
// It deliberately does NOT use UPNG at all, so test fixtures stay independent
// of the code under test. Only pako provides zlib.
var pako = require("pako");

var CRC = (function() {
	var tab = new Uint32Array(256);
	for(var n=0; n<256; n++) {
		var c = n;
		for(var k=0; k<8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		tab[n] = c >>> 0;
	}
	return function(buf, off, len) {
		var c = 0xffffffff;
		for(var i=0; i<len; i++) c = tab[(c ^ buf[off+i]) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
})();

function u32(n) { return [ (n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255 ]; }
function u16(n) { return [ (n>>>8)&255, n&255 ]; }
function ascii(s) { var a=[]; for(var i=0;i<s.length;i++) a.push(s.charCodeAt(i)); return a; }

function chunk(type, body) {
	var t = ascii(type);
	var out = u32(body.length).concat(t, body);
	out = out.concat(u32(CRC(new Uint8Array(out.slice(4)), 0, t.length + body.length)));
	return out;
}
function chunksToBuffer(chs) {
	var sig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
	return new Uint8Array(sig.concat.apply(sig, chs)).buffer;
}

// raw: filtered scanlines already prepared (filter byte per row). zlib stream.
function zlibWrap(filtered) { return pako.deflate(filtered); }
function rawWrap(filtered)   { return pako.deflateRaw(filtered); } // CgBI style

function prepFilterNone(samples, bpl, h) {
	var out = new Uint8Array((bpl + 1) * h);
	for(var y=0; y<h; y++) {
		out[y*(bpl+1)] = 0;
		out.set(samples.subarray(y*bpl, (y+1)*bpl), y*(bpl+1)+1);
	}
	return out;
}

// Adam7 interlaced, filter-0 rows. Only for whole-byte samples (bpp multiple of 8).
var A7 = {
	r0:[0,0,4,0,2,0,1], c0:[0,4,0,2,0,1,0],
	ri:[8,8,8,4,4,2,2], ci:[8,8,4,4,2,2,1]
};
function prepInterlaceNone(samples, w, h, cbpp) {
	var parts = [];
	for(var p=0; p<7; p++) {
		var rows = [];
		for(var row=A7.r0[p]; row<h; row+=A7.ri[p]) {
			var line = [0];
			for(var col=A7.c0[p]; col<w; col+=A7.ci[p]) {
				var src = (row*w + col) * cbpp;
				for(var b=0; b<cbpp; b++) line.push(samples[src+b]);
			}
			rows.push(line);
		}
		for(var r=0;r<rows.length;r++) parts.push(rows[r]);
	}
	var total = 0;
	for(var i=0;i<parts.length;i++) total += parts[i].length;
	var out = new Uint8Array(total), o = 0;
	for(var j=0;j<parts.length;j++) { out.set(parts[j], o); o += parts[j].length; }
	return out;
}

// ctype: 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba; depth per spec
function staticPNG(w, h, ctype, depth, samples /*unfiltered, packed per scanline*/, opts) {
	opts = opts || {};
	var ch = [1,null,3,1,2,null,4][ctype];
	var cbpp = Math.ceil(ch * depth / 8);
	var bpl = Math.ceil(w * ch * depth / 8);
	var filtered = opts.interlace
		? prepInterlaceNone(samples, w, h, cbpp)
		: prepFilterNone(samples, bpl, h);
	var ihdr = u32(w).concat(u32(h), [depth, ctype, 0, 0, opts.interlace ? 1 : 0]);
	var chs = [ chunk("IHDR", ihdr) ];
	if(ctype === 3) chs.push(chunk("PLTE", opts.plte));
	if(opts.trns) chs.push(chunk("tRNS", opts.trns));
	chs.push(chunk("IDAT", Array.prototype.slice.call(zlibWrap(filtered))));
	chs.push(chunk("IEND", []));
	return chunksToBuffer(chs);
}

// frames: [{rect:{x,y,width,height}, z:[deflated filtered bytes], delay:[num,den],
//           dispose, blend, useIDAT}]
// first frame's pixel bytes are written as IDAT when useIDAT is true, else as fdAT.
// opts: {numPlays, interlace, seqMap:{index:value}, numFramesOverride}
function apng(w, h, ctype, depth, frames, opts) {
	opts = opts || {};
	var ihdr = u32(w).concat(u32(h), [depth, ctype, 0, 0, opts.interlace ? 1 : 0]);
	var chs = [ chunk("IHDR", ihdr) ];
	if(ctype === 3) chs.push(chunk("PLTE", opts.plte));
	if(opts.trns) chs.push(chunk("tRNS", opts.trns));
	chs.push(chunk("acTL", u32(opts.numFramesOverride != null ? opts.numFramesOverride : frames.length).concat(u32(opts.numPlays || 0))));

	var seq = 0;
	for(var f=0; f<frames.length; f++) {
		var fr = frames[f];
		var fctlSeq = (opts.seqMap && opts.seqMap[f] != null) ? opts.seqMap[f] : seq;
		var fc = u32(fctlSeq); seq++;
		fc = fc.concat(u32(fr.rect.width), u32(fr.rect.height), u32(fr.rect.x), u32(fr.rect.y));
		fc = fc.concat(u16(fr.delay[0]), u16(fr.delay[1]), [fr.dispose, fr.blend]);
		chs.push(chunk("fcTL", fc));
		if(f === 0 && fr.useIDAT) {
			chs.push(chunk("IDAT", fr.z.slice()));
		} else {
			var fdSeq = (opts.seqMap && opts.seqMap[f + 0.5] != null) ? opts.seqMap[f + 0.5] : seq;
			seq++;
			chs.push(chunk("fdAT", u32(fdSeq).concat(fr.z.slice())));
		}
	}
	chs.push(chunk("IEND", []));
	return chunksToBuffer(chs);
}

// mutate helpers operate on the raw Uint8Array of a built file
function splice(buf, at, bytes) {
	var u = new Uint8Array(buf), n = new Uint8Array(u.length + bytes.length);
	n.set(u.subarray(0, at), 0);
	n.set(bytes, at);
	n.set(u.subarray(at), at + bytes.length);
	return n.buffer;
}
function cut(buf, at, n) {
	var u = new Uint8Array(buf), nn = new Uint8Array(u.length - n);
	nn.set(u.subarray(0, at), 0);
	nn.set(u.subarray(at + n), at);
	return nn.buffer;
}
function overwrite(buf, at, bytes) {
	var u = new Uint8Array(buf);
	for(var i=0;i<bytes.length;i++) u[at+i] = bytes[i];
	return buf;
}
function findChunks(buf) {
	var u = new Uint8Array(buf), out = [], off = 8;
	while(off < u.length) {
		var len = (u[off]*16777216) + ((u[off+1]<<16)|(u[off+2]<<8)|u[off+3]);
		var type = String.fromCharCode(u[off+4],u[off+5],u[off+6],u[off+7]);
		out.push({type:type, off:off, len:len, body:off+8, end:off+8+len}); // end = first CRC byte
		off = off + 12 + len;
	}
	return out;
}
function findChunk(buf, type) {
	var all = findChunks(buf);
	for(var i=0;i<all.length;i++) if(all[i].type === type) return all[i];
	throw new Error("chunk " + type + " not found");
}

module.exports = {
	chunk: chunk, chunksToBuffer: chunksToBuffer,
	zlibWrap: zlibWrap, rawWrap: rawWrap,
	prepFilterNone: prepFilterNone, prepInterlaceNone: prepInterlaceNone,
	staticPNG: staticPNG, apng: apng,
	splice: splice, cut: cut, overwrite: overwrite,
	findChunks: findChunks, findChunk: findChunk,
	u32: u32, u16: u16, CRC: CRC
};
