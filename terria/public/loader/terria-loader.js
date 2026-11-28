/*!
 * TERRIA loading screen, "Dawn over the land".
 *
 *   <script src="terria-loader.js" data-bg="bg.webp"></script>
 *   TerriaLoader.set(0.42) · TerriaLoader.done() · TerriaLoader.fail(text) · TerriaLoader.introDone
 *   events: terria-loader-intro, terria-loader-reveal, terria-loader-done · ?nosplash skips it
 *
 * The white TERRIA logo (vector) is drawn in light over the dark land: a pen of
 * light traces the arc, the stem of the T drops in and dawn breaks with the
 * impact, the letters rise, a shine runs across. While the game loads the logo
 * breathes and a slanted bar fills; at the end the land comes forward and the
 * screen dissolves into the game. Plain SVG + one small canvas, no libraries.
 */
(() => {
'use strict';
const SCRIPT = document.currentScript;
const BG_URL = (SCRIPT && SCRIPT.dataset.bg) || '';
const emit = (n) => dispatchEvent(new Event(n));
if (/[?&]nosplash(=|&|$)/.test(location.search)) {
  window.TerriaLoader = { set() {}, done() { emit('terria-loader-reveal'); emit('terria-loader-done'); }, fail(m) { console.error(m); }, introDone: true, progress: 1 };
  return;
}
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const P = {"arc":"M155.5 0.5L156.5 0.2L197.5 0.2L201.5 -0.1L556.5 -0L561.5 0L573.5 1L581.5 2.2L583.5 2.7L586.5 3L588.5 3.7L590.5 4L592.5 4.7L594.5 5.1L596.5 5.8L598.5 6.2L599.5 6.7L601.5 7.2L602.5 7.6L604.5 8.2L605.5 8.8L606.5 9L611.5 11.3L615.5 13.6L616.5 14.1L617.5 14.8L618.5 15.2L621.5 17.2L626.5 21.3L628.7 23.5L631.9 27.5L633.8 30.5L634.9 32.5L636.1 35.5L637 38.5L637.4 41.5L637.8 43.5L637.8 47.5L637.4 49.5L637.1 52.5L636.9 53.5L635.9 57.5L634.9 60.5L633 64.5L630.9 68.5L627.8 73.5L620.8 82.5L618.1 85.5L612.5 91.2L604.5 98.7L593.5 107.7L578.5 118.8L568.5 125.1L564.5 127.9L561.5 129.7L560.5 130.1L556.5 132.8L552.5 135L551.5 135.8L550.5 136.2L546.5 138.7L545.5 139.1L541.5 141.6L534.5 145.4L530.5 147.8L529.5 148.2L528.5 148.9L527.5 149.2L523.5 151.5L518.5 154L515.5 155.8L514.5 156.1L513.5 156.8L512.5 157.2L511.5 157.8L510.5 158.2L509.5 158.9L508.5 159.2L507.5 159.9L506.5 160.2L505.5 160.9L504.5 161.2L503.5 161.9L502.5 162.2L501.5 162.9L500.5 163.2L499.5 163.9L498.5 164.1L497.5 164.8L496.5 165.1L495.5 165.8L494.5 166.1L493.5 166.7L489.5 168.3L488.5 168.9L487.5 169.2L486.5 169.9L485.5 170.2L484.5 170.9L483.5 171.2L482.5 171.8L481.5 172.1L480.5 172.7L479.5 172.9L478.5 172.7L478.5 172.4L479.5 172L480.5 171.2L481.5 170.8L485.5 168.2L486.5 167.9L487.5 167.1L488.5 166.8L492.5 164.2L493.5 163.8L497.5 161.2L498.5 160.8L502.5 158.2L503.5 157.7L505.5 156.3L506.5 155.9L507.5 155.1L511.5 152.8L517.5 148.9L519.5 147.4L520.5 146.8L522.5 145.3L523.5 144.8L537.5 134.7L547.5 126.8L551.5 123.1L556.5 118.9L564.5 111.1L568.7 106.5L572.5 102.1L576.8 96.5L578.8 93.5L579.2 92.5L579.9 91.5L580.2 90.5L580.9 89.5L581.1 88.5L581.9 87.5L582.1 86.5L582.7 85.5L583.2 83.5L583.7 82.5L584.3 79.5L584.8 78.5L584.9 77.5L584.9 74.5L584.7 73.5L584.3 72.5L584 70.5L583.1 68.5L582.8 67.5L580.9 64.5L579.1 62.5L576.5 60.2L573.5 58.2L572.5 57.8L571.5 57.1L569.5 56.3L567.5 55.7L566.5 55.1L564.5 54.7L563.5 54.3L560.5 53.6L559.5 53.2L556.5 52.8L553.5 52.2L549.5 51.9L546.5 51.5L544.5 51.1L542.5 51.1L526.5 51.2L523.5 51.8L514.5 52.3L512.5 52.8L506.5 53.3L504.5 53.8L500.5 54.2L497.5 55L494.5 55.2L492.5 55.9L489.5 56.2L487.5 56.8L484.5 57.2L483.5 57.7L480.5 58.2L479.5 58.6L472.5 60.3L467.5 62L466.5 62.1L464.5 62.9L462.5 63.4L461.5 63.9L460.5 64.1L458.5 64.8L456.5 65.3L455.5 65.8L450.6 67.5L445.5 69.4L444.5 70L440.5 71.3L436.5 73L432.5 74.3L431.5 74.9L427.5 76.4L415.6 81.5L408.5 84.9L400.5 88.3L387.5 94.7L381.5 97.4L377.5 99.5L365.5 105.1L353.3 111.5L349.5 113.2L345.2 115.5L343.5 116.2L338.5 118.9L331.5 122.2L319.5 128.6L310.5 132.9L305.5 135.7L304.5 136L299.5 138.4L295.5 140.6L294.5 141L293.5 141.8L292.5 142.1L291.5 142.9L290.5 143.2L289.5 143.9L288.5 144.3L287.5 144.9L286.5 145.2L285.5 145.9L284.5 146.2L283.5 146.9L282.5 147.3L274.5 151.7L273.5 152L267.5 155L266.5 155.7L265.5 156.1L264.5 156.8L263.5 157.2L262.5 157.9L261.5 158.3L259.5 159.4L257.5 160.6L254.5 162.1L253.5 162.8L252.5 163.2L251.5 163.9L250.5 164.3L249.5 165L244.5 167.7L243.5 168.1L242.5 168.8L241.5 169.2L240.5 169.9L239.5 170.2L238.5 170.9L237.5 171.3L233.5 173.8L232.5 174.1L231.5 174.8L230.5 175.2L226.5 177.8L225.5 178.2L224.5 178.9L220.5 181.1L219.5 181.8L218.5 182.3L214.5 184.8L213.5 185.2L209.5 187.8L202.5 192.1L201.5 192.9L200.5 193.3L197.5 195.2L192.5 198.8L188.5 201.3L181.5 206.3L173.5 212.3L169.5 215.8L166 218.5L158.5 225.3L155.4 228.5L148.2 236.5L144.2 242.5L141.3 247.5L140.4 249.5L139.4 252.5L138.3 256.5L137.8 259.5L137.8 261.5L137.9 263.5L138.4 265.5L139.3 268.5L140.2 270.5L141.4 272.5L143 274.5L144.9 276.5L147.5 278.8L150.5 280.5L155.5 282.9L156.5 283.2L157.5 283.8L160.5 284.9L161.5 285.1L163.5 285.8L165.5 286.2L167.5 286.9L169.5 287.2L170.5 287.6L173.5 288.1L176.5 288.9L179.5 289.2L181.5 289.7L184.5 290.1L188.5 290.2L190.5 290.6L192.5 290.9L207.5 291.3L212.5 291.7L219.5 291.7L227.5 291.3L229.5 291.4L230.5 291.2L231.1 291.5L231.3 292.5L230.5 293L227.5 293.3L223.5 294L220.5 294.1L217.5 294.9L212.5 295.3L211.5 295.7L210.5 295.9L204.5 296.4L203.5 296.7L201.5 297L196.5 297.2L191.5 297.9L183.5 298.3L180.5 298.8L169.5 299.1L165.5 299.6L149.5 299.7L145.5 299.7L142.5 299.2L135.5 299.1L129.5 298.7L127.5 298.3L121.5 297.8L118.5 297.1L115.5 296.8L113.5 296.3L110.5 295.8L108.5 295.2L106.5 294.8L105.5 294.4L103.5 293.9L101.5 293.1L100.5 292.9L99.5 292.4L97.5 291.8L96.5 291.2L95.5 290.9L89.5 287.8L85.5 284.9L83 282.5L81.1 280.5L79.2 277.5L78.9 276.5L78.3 275.5L77.6 272.5L77.1 271.5L77 267.5L77.1 265.5L77.9 262.5L78.1 261.5L78.9 259.5L79.1 258.5L79.8 257.5L80 256.5L80.7 255.5L81.1 254.5L81.9 253.5L82.2 252.5L84.2 249.5L89.1 243.5L91.5 240.9L99.5 233.3L107.5 226.4L115.5 220.4L121.5 216.2L133.5 208.4L136.5 206.7L138.5 205.3L143.5 202.3L151.5 197.9L157.5 194.2L160.5 192.8L166.5 189.3L167.5 189L168.5 188.3L169.5 187.9L170.5 187.2L171.5 186.9L174.5 185.2L175.5 184.9L176.5 184.2L179.5 182.8L180.5 182.2L181.5 181.8L182.5 181.1L183.5 180.7L189.5 177.5L197.5 173.8L198.5 173.1L199.5 172.8L200.5 172.1L201.5 171.8L202.5 171.1L205.5 169.8L206.5 169.2L207.5 168.9L208.5 168.3L212.5 166.7L215.5 165.1L216.5 164.8L217.5 164.1L218.5 163.8L219.5 163.1L220.5 162.8L221.5 162.2L222.5 161.8L223.5 161.2L224.5 160.9L225.5 160.2L226.5 159.9L227.5 159.3L232.5 157.1L233.5 156.8L234.5 156.1L235.5 155.8L238.5 154.3L240.5 153.6L241.5 153L242.5 152.7L243.5 152.1L244.5 151.9L245.5 151.3L249.5 149.8L252.5 148.2L253.5 147.9L254.5 147.3L259.5 145L260.5 144.7L261.5 144.1L262.5 143.8L263.5 143.2L264.5 142.9L268.5 141L269.5 140.7L270.5 140.1L271.5 139.8L274.5 138.3L276.5 137.6L279.5 136.2L280.5 135.9L284.5 134L285.5 133.7L286.5 133.1L289.5 131.8L290.5 131.2L295.5 129L296.5 128.7L297.5 128.1L298.5 127.8L304.5 125.1L305.5 124.8L308.5 123.3L310.5 122.5L311.5 121.9L311.9 121.5L312.6 119.5L313.1 117.5L313.9 115.5L314 114.5L315.9 109.5L316 108.5L316.9 106.5L317 105.5L317.9 103.5L318.1 102.5L318.6 101.5L319.2 99.5L319.7 98.5L320.1 96.5L320.6 95.5L321.1 93.5L321.7 92.5L322.2 90.5L322.7 89.5L323.2 87.5L323.6 86.5L324.1 84.5L324.9 82.5L325 81.5L325.9 79.5L326.3 77.5L326.8 76.5L328.2 71.5L329 69.5L328.7 68.5L328.5 68.3L327.5 68.3L201.5 68.3L197.5 68.2L196.5 68.1L196 67.5L195.6 66.5L194.2 64.5L193.8 63.5L193.1 62.5L190.8 58.5L188.1 54.5L184.6 48.5L181.2 43.5L180.8 42.5L180 41.5L176.7 35.5L175.9 34.5L174.8 32.5L174 31.5L172.1 28.5L171.6 27.5L164.1 15.5L160.6 9.5L157.3 4.5L156.8 3.5L155.3 1.5Z","stem":"M446.5 84.5L447.5 84L448.3 84.5L447.7 86.5L447.1 87.5L446 90.5L445.8 91.5L445.2 92.5L444.6 94.5L444.1 95.5L443.8 96.5L443.1 97.5L442.9 98.5L442 100.5L441.7 101.5L441.1 102.5L440.8 103.5L440.2 104.5L439 107.5L438.8 108.5L438.1 109.5L437.9 110.5L437 112.5L436.7 113.5L436.1 114.5L435.9 115.5L435 117.5L434.8 118.5L434.1 119.5L433.9 120.5L433.2 121.5L432 124.5L431.7 125.5L431.2 126.5L429.7 130.5L429.1 131.5L428.8 132.5L427.9 134.5L425.6 140.5L425 141.5L424.8 142.5L422.1 148.5L420.6 152.5L418.6 157.5L406.4 186.5L401.7 198.5L399.4 203.5L395 214.5L389.3 227.5L384.8 238.5L383.4 241.5L381 247.5L380.4 248.5L379.8 250.5L379.3 251.5L379 252.5L377.8 255.5L377.2 256.5L376.9 257.5L376.3 258.5L376 259.5L374.2 263.5L373.9 264.5L373.3 265.5L373.1 266.5L372.2 268.5L372 269.5L371.4 270.5L370.8 272.5L370.2 273.5L370 274.5L369.4 275.5L368.8 277.5L368.2 278.5L367.9 279.5L367.3 280.5L365.8 284.5L365.3 285.5L365 286.5L364.1 288.5L363.8 289.5L363.2 290.5L363 291.5L362.4 292.5L361.8 294.5L361.2 295.5L360.9 296.5L359.4 299.5L358.8 301.5L358.2 302.5L357.5 304.5L356.5 305.3L305.5 305.4L251.5 305.3L250.5 304.6L250.4 304.5L251 303.5L251.4 301.5L252.4 298.5L252.9 297.5L253.5 295.6L254 294.5L254.2 293.5L256.1 288.5L256.2 287.5L257.1 285.5L258.3 281.5L260.1 276.5L260.3 275.5L260.8 274.5L262.4 269.5L265 262.5L269.3 249.5L271.2 244.5L279.8 218.5L281.7 213.5L286 200.5L287.6 196.5L289.8 189.5L290.9 185.5L291.8 183.5L291.9 182.5L292.7 180.5L295.2 172.5L295.7 171.5L296.2 169.5L299.1 161.5L299.5 161.1L302.5 159.4L305.5 157.9L306.5 157.2L307.5 156.8L313.5 153.2L314.5 152.8L315.5 152.1L316.5 151.8L317.5 151.1L318.5 150.8L319.5 150.1L320.5 149.8L326.5 146.3L327.5 145.9L328.5 145.2L329.5 144.8L330.5 144.1L331.5 143.7L332.5 143L338.5 139.9L339.5 139.2L340.5 138.8L343.5 137L344.5 136.7L348.5 134.4L353.5 131.8L354.5 131.1L355.5 130.7L359.5 128.3L364.5 125.8L367.5 124.1L368.5 123.8L373.5 121L385.5 114.8L390.5 112L393.5 110.7L403.5 105.3L417.5 98.7L431.5 91.4Z","letters":["M13.9 336.5L14.5 336.1L22.5 336L89.5 336L120.5 336.1L121.5 336L122.3 336.5L121.9 337.5L105.5 355.5L104.5 355.9L74.5 355.9L71.5 356.1L71.2 356.5L70.6 358.5L70.1 359.5L69.9 360.5L69 362.5L68.7 363.5L68.1 364.5L67.9 365.5L67 367.5L66.8 368.5L66 370.5L65.8 371.5L65.2 372.5L64.8 374.5L64.2 375.5L63.6 377.5L63.1 378.5L62.9 379.5L62 381.5L61.8 382.5L61.2 383.5L60.6 385.5L60.1 386.5L59.9 387.5L59 389.5L58.8 390.5L58 392.5L57.7 393.5L57.2 394.5L55.9 398.5L55 400.5L54.8 401.5L54.2 402.5L53.6 404.5L53.1 405.5L51.7 409.5L51.1 410.5L50.9 411.5L49 416.5L48.5 417.1L47.5 417.3L26.5 417.4L20.5 417.3L19.5 416.9L19.2 416.5L22.6 407.5L26.8 395.5L31.5 383.5L33.9 376.5L34.7 374.5L38.9 362.5L41 357.5L41.1 356.5L40.5 356L39.5 355.9L1.5 356L0.5 355.6L0.4 355.5L0.8 354.5L4.1 349.5L6.3 346.5L8.7 343.5L11.4 339.5L13.5 336.8Z","M138.8 336.5L139.5 336.1L150.5 336L196.5 336L246.5 336L247.3 336.5L246.9 337.5L244.2 340.5L241.8 343.5L231.6 354.5L230.5 355.5L229.5 355.7L225.5 355.7L161.5 355.8L160.7 356.5L160.2 357.5L157 365.5L156.9 366.5L157.5 367.1L216.5 367.1L220.5 367.1L221.5 367.3L221.7 367.5L221.6 368.5L220.3 370.5L219.9 371.5L219.3 372.5L218.9 373.5L218.2 374.5L217.9 375.5L214.3 381.5L213.9 382.5L213.2 383.5L212.9 384.5L212.5 384.9L211.5 385.2L196.5 385.4L150.5 385.5L149.5 386.5L145.7 396.5L145.7 397.5L146.5 397.9L218.5 398L221.5 398L222.5 398.2L222.8 398.5L222.3 399.5L221.7 401.5L221.2 402.5L220.9 403.5L220.1 405.5L219.9 406.5L219.3 407.5L218.8 409.5L218.2 410.5L217.7 412.5L217.1 413.5L216.9 414.5L216.1 416.5L215.5 417.2L115.5 417.3L110.5 417.2L109.5 416.6L109.4 416.5L110.7 413.5L111.2 411.5L111.8 410.5L112.3 408.5L112.9 407.5L113.4 405.5L115 401.5L115.1 400.5L116 398.5L116.2 397.5L117 395.5L117.3 394.5L117.9 393.5L119.2 389.5L120 387.5L120.2 386.5L120.8 385.5L121.3 383.5L121.8 382.5L122.3 380.5L122.8 379.5L124.2 375.5L125.1 373.5L125.3 372.5L125.8 371.5L127.2 367.5L128.1 365.5L128.3 364.5L131 357.5L133.3 350.5L133.8 349.5L134.4 347.5L136.1 343.5L138.2 337.5Z","M270.7 336.5L271.5 336.1L350.5 336.1L354.5 336.4L356.5 336.7L360.3 337.5L363.5 338.4L365.5 339.2L367.5 340.2L370.5 342.5L372.7 345.5L374 348.5L374.5 351.5L374.5 354.5L373.9 358.5L373.1 360.5L373.1 361.5L372.2 363.5L372.1 364.5L370 369.5L367.9 373.5L365.7 376.5L362.5 379.8L357.5 383.7L355.5 384.9L351.5 386.8L350.5 387L348.5 387.9L347.5 388.1L345.5 388.8L342.5 389.3L340.5 389.8L338.5 390L337.3 390.5L339.2 393.5L340.9 395.5L341.4 396.5L343.6 399.5L344.2 400.5L346.7 403.5L347.2 404.5L348.9 406.5L350.2 408.5L351.9 410.5L353.2 412.5L354.8 414.5L355.3 415.5L356.2 416.5L355.5 417.2L327.5 417.3L321.5 417.2L320.5 416.3L319.2 414.5L317.9 412.5L314.2 407.5L311.6 403.5L309.3 400.5L308.8 399.5L307.3 397.5L306.8 396.5L304.7 393.5L303.5 391.9L302.5 391.2L275.5 391.2L274.5 391.7L273.1 394.5L265.4 415.5L265.1 416.5L264.5 417.1L263.5 417.4L240.5 417.3L236.5 417.3L235.5 417.1L235.1 416.5L236.1 414.5L236.3 413.5L236.8 412.5L237.4 410.5L237.9 409.5L238.2 408.5L238.8 407.5L242.4 396.5L243 395.5L243.2 394.5L244 392.5L244.2 391.5L244.8 390.5L245.3 388.5L245.8 387.5L246.9 384.5L247.1 383.5L248 381.5L248.2 380.5L250 376.5L252.5 369.5L253.5 367.4L254.5 367.1L281.5 366.9L282.5 367.1L282.8 367.5L282.6 368.5L281.2 371.5L281.5 372.2L282.5 372.6L303.5 372.5L331.5 372.6L336.5 371.7L338.5 370.7L340 369.5L341 368.5L341.8 367.5L342.2 366.5L342.9 365.5L343.2 364.5L343.7 363.5L343.9 362.5L344 359.5L343.6 358.5L342.5 357.1L341.5 356.5L339.5 355.9L337.5 355.7L328.5 355.6L264.5 355.7L258.5 355.6L258.1 354.5L258.8 353.5L259.2 352.5L260.4 350.5L263.2 346.5L267 341.5L269 338.5Z","M402.6 336.5L403.5 336.1L421.5 336L469.5 336L485.5 336.2L488.5 336.6L491.5 337.2L495.5 338.4L497.5 339.1L499.5 340.2L501.5 341.5L502.5 342.4L504.9 345.5L506 347.5L506.8 350.5L506.9 354.5L506 358.5L505.2 360.5L505.1 361.5L504.2 363.5L504 364.5L503.2 366.5L503 367.5L502.3 368.5L502.1 369.5L501.1 371.5L498.6 375.5L495.9 378.5L492.5 381.7L489.5 383.8L486.4 385.5L483.5 386.9L482.5 387.1L481.5 387.6L479.5 388.1L477.5 388.8L475.5 389.2L473.5 389.8L470.5 390.1L469.9 390.5L470.1 391.5L471.7 393.5L472.2 394.5L473.9 396.5L474.4 397.5L475.9 399.5L477.1 401.5L478.9 403.5L480.1 405.5L481.8 407.5L482.3 408.5L483.9 410.5L485.1 412.5L485.9 413.5L486.4 414.5L488 416.5L487.5 417.1L469.5 417.3L453.5 417.2L452.5 416.2L451.3 414.5L450.8 413.5L447.1 408.5L443.9 403.5L442.3 401.5L441.8 400.5L440.3 398.5L437.8 394.5L435.6 391.5L434.5 391.1L431.5 391.1L407.5 391.1L406.7 391.5L406 392.5L405.5 393.7L400.5 407.5L399.2 410.5L397.1 416.5L396.5 417.1L395.5 417.3L368.5 417.2L367.8 416.5L368.1 415.5L369 413.5L369.2 412.5L370 410.5L370.2 409.5L371.1 407.5L371.2 406.5L371.8 405.5L372.3 403.5L372.8 402.5L373.3 400.5L373.9 399.5L375.2 395.5L376.1 393.5L376.3 392.5L378 388.5L378.2 387.5L379 385.5L379.2 384.5L380 382.5L380.2 381.5L383.1 374.5L384.4 370.5L384.9 369.5L385.2 368.5L385.5 367.8L386.5 367.1L392.5 367L414.5 367.1L414.9 367.5L414.8 368.5L413.4 371.5L414.5 372.6L463.5 372.6L464.5 372.6L468.5 371.7L470.5 370.7L472.1 369.5L473.5 368.1L474.6 366.5L475 365.5L475.3 364.5L475.8 363.5L476 362.5L476 359.5L475.7 358.5L474.5 357L473.5 356.4L470.5 355.7L459.5 355.5L390.5 355.7L390.1 355.5L390 354.5L390.9 353.5L395.8 346.5L401 338.5Z","M532.1 336.5L532.5 336.1L533.5 335.9L560.5 335.9L561.5 336.5L560 340.5L559.8 341.5L559.2 342.5L558 345.5L555.7 352.5L554 356.5L553.8 357.5L551.1 364.5L550.6 366.5L548 373.5L547.7 374.5L547.2 375.5L541.6 391.5L540 395.5L537.7 402.5L535.3 408.5L533.7 413.5L532.9 415.5L532.6 416.5L531.5 417.3L511.5 417.3L503.5 417.2L502.9 416.5L503.2 415.5L503.7 414.5L504.2 412.5L504.8 411.5L506.5 406.5L506.9 405.5L507.2 404.5L509.1 399.5L509.3 398.5L509.9 397.5L510.4 395.5L510.9 394.5L512.3 390.5L512.9 389.5L513.5 387.5L513.9 386.5L519.5 370.5L519.9 369.5L522.4 362.5L524 358.5L528.3 346.5Z","M634 335.5L634.5 335.3L637.5 335L640.5 334.9L644.5 334.9L646.5 335.2L650.5 336.2L652.5 337.1L654.5 338.3L656 339.5L656.8 340.5L659.5 346.6L663.4 357.5L665.6 362.5L670.9 376.5L672.7 380.5L675.2 387.5L675.7 388.5L676 389.5L676.5 390.6L677.1 392.5L677.7 393.5L677.9 394.5L678.8 396.5L679 397.5L680.6 401.5L681.3 403.5L681.8 404.5L682 405.5L683.1 408.5L683.7 409.5L683.9 410.5L684.8 412.5L685 413.5L686.1 416.5L685.5 417.2L653.5 417.3L652.5 417.2L651.6 416.5L644.8 395.5L644.3 394.5L643.8 392.5L642.1 387.5L641.2 385.5L639 378.5L637.2 373.5L635 366.5L634.2 364.5L634.1 363.5L633.2 361.5L632.5 360.3L630.5 362L621.5 371.5L615.4 377.5L610.8 382.5L598.5 395L587.7 406.5L577.5 417L576.5 417.3L572.5 417.3L550.5 417.3L545.5 417.1L545 416.5L562.2 399.5L567 394.5L590.5 371.2L596.5 365.6L611.5 350.8L616.7 345.5L620.5 341.9L622.5 340.2L625.5 338.4L630.5 336.4L632.5 336Z"]};

// ---------------------------------------------------------------- timeline (s)
const T_ARC = [0.35, 1.45];      // the pen of light traces the arc
const T_ARC_FILL = [1.15, 1.6];  // the arc fills in
const T_STEM = [1.25, 1.75];     // the stem drops in
const T_IMPACT = 1.62;           // stem lands: ring, shake, dawn
const T_LETTERS = [1.7, 2.55];   // letters rise one by one
const T_SHINE = [2.45, 3.25];    // first shine
const T_INTRO_END = 3.0;
const EXIT = 0.9;

// ---------------------------------------------------------------- DOM
const css = `
#terria-loader{position:fixed;inset:0;z-index:2147483000;overflow:hidden;background:#07110c;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}
#terria-loader .tl-bg{position:absolute;inset:-4%;background:#25451f center/cover no-repeat;will-change:transform,filter}
#terria-loader .tl-vig{position:absolute;inset:0;background:radial-gradient(ellipse 75% 55% at 50% 44%,rgba(4,12,8,.0) 0%,rgba(4,12,8,.35) 55%,rgba(2,8,5,.8) 100%)}
#terria-loader canvas{position:absolute;inset:0;width:100%;height:100%}
#terria-loader .tl-stage{position:absolute;left:50%;top:42%;width:min(78vw,520px);transform:translate(-50%,-50%);will-change:transform}
#terria-loader svg{display:block;width:100%;height:auto;overflow:visible;filter:drop-shadow(0 10px 18px rgba(0,0,0,.45))}
#terria-loader .tl-ui{position:absolute;left:50%;top:calc(42% + min(78vw,520px)*0.39 + 34px);transform:translateX(-50%);width:min(52vw,300px);opacity:0}
#terria-loader .tl-track{height:5px;border-radius:2px;background:rgba(255,255,255,.16);transform:skewX(-20deg);overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.35)}
#terria-loader .tl-fill{height:100%;width:0;background:linear-gradient(90deg,#fff6dc,#ffffff 60%,#ffe9a8);box-shadow:0 0 12px rgba(255,236,170,.9)}
#terria-loader .tl-row{display:flex;justify-content:space-between;margin-top:10px;color:rgba(255,255,255,.82);font-size:11px;
  letter-spacing:.38em;text-transform:uppercase;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.7)}
#terria-loader .tl-row b{font-weight:600;letter-spacing:.14em;color:#fff}
#terria-loader.tl-failed .tl-track,#terria-loader.tl-failed .tl-row b{display:none}
#terria-loader.tl-failed .tl-row{justify-content:center;letter-spacing:.03em;text-transform:none;font-size:14px}`;
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const NS = 'http://www.w3.org/2000/svg';
const root = document.createElement('div');
root.id = 'terria-loader';
root.setAttribute('role', 'progressbar');
root.setAttribute('aria-label', 'Загрузка TERRIA');
root.innerHTML = `<div class="tl-bg"></div><div class="tl-vig"></div><canvas></canvas>
<div class="tl-stage"><svg viewBox="-20 -30 726 480" aria-hidden="true">
<defs>
 <linearGradient id="tl-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e9e2d0"/></linearGradient>
 <linearGradient id="tl-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fffbe8" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <radialGradient id="tl-pen"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#fff6d0" stop-opacity=".9"/><stop offset="1" stop-color="#ffd977" stop-opacity="0"/></radialGradient>
 <filter id="tl-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
 <clipPath id="tl-base"><rect x="-40" y="318" width="780" height="110"/></clipPath>
 <mask id="tl-mask"><g fill="#fff" class="tl-maskparts"></g></mask>
</defs>
<g class="tl-logo">
 <g class="tl-glowlayer" filter="url(#tl-glow)" opacity="0"></g>
 <g class="tl-glowletters" filter="url(#tl-glow)" opacity="0"></g>
 <path class="tl-arc-fill" fill="url(#tl-g)" opacity="0"/>
 <path class="tl-arc-line" fill="none" stroke="#fff8e2" stroke-width="2.6" stroke-linejoin="round"/>
 <g class="tl-stem-g"><path class="tl-stem" fill="url(#tl-g)"/></g>
 <g clip-path="url(#tl-base)" class="tl-letters"></g>
 <g mask="url(#tl-mask)"><rect class="tl-shine" x="-300" y="-40" width="260" height="500" fill="url(#tl-shine)" transform="skewX(-20)" opacity="0"/></g>
 <circle class="tl-ring" cx="345" cy="300" r="10" fill="none" stroke="#fff6d6" stroke-width="5" opacity="0"/>
 <circle class="tl-pen" r="22" fill="url(#tl-pen)" opacity="0"/>
</g></svg></div>
<div class="tl-ui"><div class="tl-track"><div class="tl-fill"></div></div><div class="tl-row"><span>Загрузка</span><b>0%</b></div></div>`;
(document.body || document.documentElement).appendChild(root);

const $ = (s) => root.querySelector(s);
const bg = $('.tl-bg');
if (BG_URL) bg.style.backgroundImage = `url("${BG_URL}")`;
const stage = $('.tl-stage');
const arcFill = $('.tl-arc-fill');
const arcLine = $('.tl-arc-line');
const stemG = $('.tl-stem-g');
const stem = $('.tl-stem');
const lettersG = $('.tl-letters');
const shine = $('.tl-shine');
const ring = $('.tl-ring');
const pen = $('.tl-pen');
const glowLayer = $('.tl-glowlayer');
const glowLetters = $('.tl-glowletters');
const ui = $('.tl-ui');
const fillEl = $('.tl-fill');
const pctEl = $('.tl-row b');
arcFill.setAttribute('d', P.arc);
arcLine.setAttribute('d', P.arc);
stem.setAttribute('d', P.stem);
const maskParts = $('.tl-maskparts');
[P.arc, P.stem, ...P.letters].forEach((d, i) => {
  const m = document.createElementNS(NS, 'path');
  m.setAttribute('d', d);
  maskParts.appendChild(m);
  const g = document.createElementNS(NS, 'path');
  g.setAttribute('d', d);
  g.setAttribute('fill', '#fff4cc');
  (i < 2 ? glowLayer : glowLetters).appendChild(g);
});
const letters = P.letters.map((d) => {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'url(#tl-g)');
  lettersG.appendChild(p);
  return p;
});
const arcLen = arcLine.getTotalLength();
arcLine.style.strokeDasharray = `${arcLen} ${arcLen}`;

// ---------------------------------------------------------------- public API
let target = 0, shown = 0, doneRequested = false, failed = false, introDone = false, exitStart = -1, removed = false;
window.TerriaLoader = {
  set(p) { target = Math.max(target, Math.min(1, +p || 0)); },
  done() { if (!failed) { doneRequested = true; target = 1; } },
  fail(msg) { failed = true; doneRequested = false; root.classList.add('tl-failed'); ui.style.opacity = 1; root.querySelector('.tl-row span').textContent = msg; },
  get progress() { return shown; },
  get introDone() { return introDone; },
};
let bgReady = !BG_URL;
if (BG_URL) {
  const im = new Image();
  im.onload = im.onerror = () => { bgReady = true; };
  im.src = BG_URL;
  setTimeout(() => { bgReady = true; }, 2500);
}

// ---------------------------------------------------------------- motes
const cv = root.querySelector('canvas');
const cx = cv.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
const motes = [];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 70; i++) motes.push({ x: rnd(), y: rnd(), z: 0.3 + rnd() * 0.7, s: rnd() * 6.28, v: 0.01 + rnd() * 0.025 });
function sizeCanvas() {
  dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (w !== cw || h !== ch) { cv.width = cw = w; cv.height = ch = h; }
}
function drawMotes(t, dt, light) {
  sizeCanvas();
  cx.clearRect(0, 0, cw, ch);
  cx.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    m.y -= m.v * dt * m.z;
    m.x += Math.sin(t * 0.6 + m.s) * 0.0006 * m.z;
    if (m.y < -0.05) { m.y = 1.05; m.x = rnd(); }
    const a = (0.25 + 0.75 * Math.max(0, Math.sin(t * 1.7 + m.s * 3))) * light * m.z;
    const r = (1.2 + 2.6 * m.z) * dpr;
    const g = cx.createRadialGradient(m.x * cw, m.y * ch, 0, m.x * cw, m.y * ch, r * 3);
    g.addColorStop(0, `rgba(255,244,200,${0.75 * a})`);
    g.addColorStop(1, 'rgba(255,230,160,0)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(m.x * cw, m.y * ch, r * 3, 0, 6.283);
    cx.fill();
  }
  cx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prog = (t, [a, b]) => clamp((t - a) / (b - a));
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

// ---------------------------------------------------------------- frame
let t0 = -1, last = 0, lastShine = T_SHINE[0];
function frame(now) {
  if (removed) return;
  requestAnimationFrame(frame);
  if (window.__TL_CLOCK) now = window.__TL_CLOCK();
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  shown += (target - shown) * Math.min(1, dt * 4);
  if (target - shown < 0.002) shown = target;
  fillEl.style.width = (shown * 100).toFixed(1) + '%';
  pctEl.textContent = Math.round(shown * 100) + '%';
  root.setAttribute('aria-valuenow', Math.round(shown * 100));
  if (!bgReady) { drawMotes(0, dt, 0.3); return; }
  if (t0 < 0) t0 = now;
  let t = (now - t0) / 1000;
  if (REDUCED) t = Math.max(t, T_INTRO_END + 0.5);
  if (t >= T_INTRO_END && !introDone) { introDone = true; emit('terria-loader-intro'); }

  // exit
  if (doneRequested && exitStart < 0 && introDone && shown > 0.995) { exitStart = t; emit('terria-loader-reveal'); }
  const ex = exitStart < 0 ? 0 : clamp((t - exitStart) / EXIT);

  // dawn: the land brightens when the stem lands
  const dawn = easeOut(clamp((t - T_IMPACT + 0.15) / 1.4));
  const night = 0.16 + 0.1 * clamp(t / T_IMPACT);
  const bright = night + (0.66 - night) * dawn + 0.34 * easeInOut(ex);
  const flash = Math.max(0, 1 - Math.abs(t - T_IMPACT - 0.05) / 0.25) * 0.25;
  bg.style.filter = `brightness(${(bright + flash).toFixed(3)}) saturate(${(0.7 + 0.4 * dawn).toFixed(2)})`;
  const push = 1.06 - 0.06 * easeOut(clamp(t / 3.5)) + 0.1 * easeInOut(ex);
  bg.style.transform = `scale(${push.toFixed(4)})`;
  drawMotes(t, dt, 0.5 + 0.5 * dawn * (1 - ex));

  // the pen of light traces the arc, then it fills
  const a = easeInOut(prog(t, T_ARC));
  arcLine.style.strokeDashoffset = String(arcLen * (1 - a));
  const af = easeOut(prog(t, T_ARC_FILL));
  arcFill.setAttribute('opacity', af.toFixed(3));
  arcLine.setAttribute('opacity', (a > 0 ? 1 - af : 0).toFixed(3));
  if (a > 0 && a < 1) {
    const pt = arcLine.getPointAtLength(arcLen * a);
    pen.setAttribute('cx', pt.x);
    pen.setAttribute('cy', pt.y);
    pen.setAttribute('opacity', String(Math.min(1, a * 8, (1 - a) * 8)));
  } else pen.setAttribute('opacity', '0');

  // the stem drops in and lands
  const s = prog(t, T_STEM);
  const sy = (1 - easeOutBack(s)) * -150;
  stemG.setAttribute('transform', `translate(0 ${sy.toFixed(2)})`);
  stemG.setAttribute('opacity', clamp(s * 4).toFixed(3));
  const ri = clamp((t - T_IMPACT) / 0.7);
  ring.setAttribute('r', (10 + 150 * easeOut(ri)).toFixed(1));
  ring.setAttribute('opacity', (ri > 0 && ri < 1 ? 0.8 * (1 - ri) : 0).toFixed(3));
  ring.setAttribute('stroke-width', (6 * (1 - ri) + 0.5).toFixed(2));
  const shake = t > T_IMPACT && t < T_IMPACT + 0.35 ? Math.sin((t - T_IMPACT) * 70) * 5 * (1 - (t - T_IMPACT) / 0.35) : 0;

  // the letters rise from below the line, one by one
  letters.forEach((p, i) => {
    const k = clamp((t - T_LETTERS[0] - i * 0.09) / 0.5);
    p.setAttribute('transform', `translate(0 ${((1 - easeOut(k)) * 95).toFixed(2)})`);
    p.setAttribute('opacity', clamp(k * 3).toFixed(3));
  });

  // shine: once at the end of the intro, then every few seconds
  let sh = prog(t, T_SHINE);
  if (t > T_SHINE[1] + 0.2) {
    const period = 3.6;
    const ph = ((t - T_SHINE[1]) % period) / 0.9;
    sh = ph <= 1 ? ph : 0;
  }
  shine.setAttribute('x', (-320 + 1180 * easeInOut(sh)).toFixed(1));
  shine.setAttribute('opacity', sh > 0 && sh < 1 ? '0.9' : '0');
  const idle = clamp((t - T_LETTERS[1]) / 0.5) * (0.14 + 0.08 * Math.sin(t * 2.2));
  const hit = Math.max(0, 1 - Math.abs(t - T_IMPACT) / 0.5) * 0.6;
  glowLayer.setAttribute('opacity', (Math.max(hit, idle) * (1 - ex)).toFixed(3));
  glowLetters.setAttribute('opacity', (idle * (1 - ex)).toFixed(3));

  // breathing, impact shake and the exit
  const breathe = t > T_INTRO_END ? Math.sin((t - T_INTRO_END) * 1.6) * 3 : 0;
  const scale = 1 + 0.08 * easeInOut(ex);
  stage.style.transform = `translate(calc(-50% + ${shake.toFixed(2)}px), calc(-50% + ${(breathe - 10 * ex).toFixed(2)}px)) scale(${scale.toFixed(4)})`;
  stage.style.opacity = String(1 - easeInOut(clamp(ex * 1.4)));
  ui.style.opacity = failed ? '1' : String(clamp((t - T_LETTERS[1]) / 0.4) * (1 - clamp(ex * 3)));
  root.style.opacity = String(1 - easeInOut(clamp((ex - 0.35) / 0.65)));
  if (ex >= 1) finish();
}
requestAnimationFrame(frame);

function finish() {
  removed = true;
  root.remove();
  style.remove();
  emit('terria-loader-done');
}
})();
