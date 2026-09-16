/**
 * Original Halloween stage materials, authored for Prism Mapper under the MIT
 * license. All anatomy and gore are stylized procedural drawings. Coordinates
 * follow the mapped surface and every loop has a fixed WebGL 1 compatible bound.
 * Brightness changes are continuous; no material uses full-frame strobing.
 */
export const halloweenGLSL = `
float hal_hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float hal_hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hal_noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hal_hash2(i),hal_hash2(i+vec2(1.0,0.0)),f.x),mix(hal_hash2(i+vec2(0.0,1.0)),hal_hash2(i+1.0),f.x),f.y);
}
float hal_fog(vec2 p) { return .57*hal_noise(p)+.28*hal_noise(p*2.03+7.1)+.15*hal_noise(p*4.11+19.3); }
vec2 hal_rotate(vec2 p,float a) {float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
float hal_ellipse(vec2 p,vec2 size) {return (length(p/size)-1.0)*min(size.x,size.y);}
float hal_fill(float d) {return 1.0-smoothstep(-.002,.003,d);}
float hal_line(vec2 p,vec2 a,vec2 b) {vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/max(dot(v,v),.00001),0.0,1.0));}
float hal_triangle(vec2 p,vec2 a,vec2 b,vec2 c) {
  float e1=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
  float e2=(c.x-b.x)*(p.y-b.y)-(c.y-b.y)*(p.x-b.x);
  float e3=(a.x-c.x)*(p.y-c.y)-(a.y-c.y)*(p.x-c.x);
  return smoothstep(-.0003,.0003,min(e1,min(e2,e3)));
}
vec2 hal_scene(vec2 uv) {return (uv-.5)*vec2(clamp(u_surfaceAspect,.45,3.0),1.0);}
float hal_grain(vec2 p) {return hal_noise(p*180.0)*.6+hal_noise(p*63.0)*.4;}

vec3 hal_eyes(vec2 uv,float t) {
  vec2 p=hal_scene(uv); p*=1.0+.014*sin(t*.47);
  float mist=hal_fog(p*5.0+vec2(t*.025,-t*.017));
  vec3 col=vec3(.003,.005,.008)+vec3(.025,.043,.035)*mist*.35;
  for(int i=0;i<2;i++) {
    float side=float(i)*2.0-1.0;
    vec2 q=p-vec2(side*.245,-.025); q.y+=side*q.x*.19;
    float blink=1.0-.97*pow(.5+.5*sin(t*.71+.25),32.0);
    float lid=.079*blink*(1.0-pow(clamp(abs(q.x)/.193,0.0,1.0),1.65));
    float eye=hal_fill(max(abs(q.x)-.19,abs(q.y)-lid));
    vec2 look=vec2(.025*sin(t*.33),.014*sin(t*.27));
    float iris=length((q-look)*vec2(1.0,1.13));
    float pupil=hal_fill(hal_ellipse(q-look,vec2(.013+.003*sin(t*.5),.060)));
    float fibers=.5+.5*sin(atan(q.y-look.y,q.x-look.x)*43.0+iris*150.0);
    vec3 amber=mix(vec3(.12,.008,.001),vec3(.90,.31,.018),exp(-pow((iris-.048)/.035,2.0))*(.6+.4*fibers));
    amber=mix(amber,vec3(.001,.000,.001),pupil);
    amber+=vec3(.95,.62,.20)*exp(-length(q-look-vec2(-.017,-.022))*220.0);
    col+=vec3(.44,.025,.001)*exp(-length(q*vec2(.55,1.5))*19.0)*.32;
    col=mix(col,amber,eye);
    float brow=hal_line(q,vec2(-.18*side,-.112),vec2(.15*side,-.058));
    col+=vec3(.16,.085,.042)*exp(-brow*80.0)*.3;
  }
  return col;
}

vec3 hal_blood(vec2 uv,float t) {
  vec2 p=uv; float grain=hal_grain(p);
  vec3 col=vec3(.025,.009,.012)+grain*vec3(.017,.012,.014);
  float surface=.135+.025*sin(p.x*13.0+t*.24)+.013*sin(p.x*37.0-t*.37);
  float blood=hal_fill(p.y-surface);
  float sheen=0.0;
  for(int i=0;i<12;i++) {
    float fi=float(i),seed=hal_hash(fi+12.0);
    float x=(fi+.28+seed*.44)/12.0;
    float head=.22+seed*.59+.075*sin(t*(.17+seed*.11)+fi*2.3);
    float width=.009+seed*.013;
    float stem=hal_fill(max(abs(p.x-x)-width*(.65+.35*sin(p.y*8.0+fi)),max(surface-p.y,p.y-head)));
    float drop=hal_fill(hal_ellipse(p-vec2(x,head),vec2(width*1.28,width*2.0)));
    blood=max(blood,max(stem,drop));
    sheen+=exp(-pow((p.x-x+width*.43)/.003,2.0))*smoothstep(surface+.02,surface+.06,p.y)*(1.0-smoothstep(head-.035,head,p.y));
    float fallingY=fract(t*(.027+seed*.018)+seed)*1.25;
    float loose=hal_fill(hal_ellipse(p-vec2(x,head+fallingY),vec2(width*.38,width*.7)))*smoothstep(.04,.08,fallingY);
    blood=max(blood,loose);
  }
  float flow=.5+.5*sin(p.y*31.0-t*.68+hal_noise(p*13.0)*2.0);
  vec3 wet=vec3(.20,.0015,.008)+vec3(.23,.009,.012)*(grain*.3+flow*.35);
  col=mix(col,wet,blood);
  col+=vec3(.35,.045,.050)*min(sheen,1.0)*blood*.62;
  col+=vec3(.21,.011,.018)*exp(-abs(p.y-surface)*160.0);
  return col;
}

vec3 hal_veins(vec2 uv,float t) {
  vec2 p=hal_scene(uv); float skin=hal_fog(p*8.0+vec2(.004*sin(t*.3),0.0));
  vec3 col=mix(vec3(.20,.155,.14),vec3(.43,.35,.29),skin);
  col+=vec3(.042,.025,.023)*(hal_grain(p)-.5);
  float vessel=0.0,halo=0.0;
  for(int i=0;i<8;i++) {
    float fi=float(i); float x=(fi-3.5)*.24;
    float trunk=x+.065*sin(p.y*5.0+fi*1.9)+.014*sin(p.y*23.0+fi);
    float pulse=.72+.28*sin(t*1.5-p.y*4.0+fi*.4);
    float d=abs(p.x-trunk);
    vessel=max(vessel,exp(-d*d/(.000024+.000034*pulse)));
    halo=max(halo,exp(-d*d/.001));
    for(int j=0;j<3;j++) {
      float fj=float(j),start=-.34+fj*.30;
      float h=p.y-start; float branch=trunk+sin(fi*3.0+fj)*h*.92;
      float bd=abs(p.x-branch);
      float visible=smoothstep(-.015,.015,h)*(1.0-smoothstep(.16,.32,h));
      vessel=max(vessel,exp(-bd*bd/.000009)*visible*pulse);
      halo=max(halo,exp(-bd*bd/.00025)*visible*.6);
    }
  }
  col=mix(col,vec3(.20,.033,.055),halo*.45);
  col=mix(col,vec3(.30,.003,.030)*( .77+.23*sin(t*1.5-p.y*4.0)),vessel*.92);
  return col*(.85+.15*cos(length(p)*1.6));
}

vec3 hal_skull(vec2 uv,float t) {
  vec2 p=hal_scene(uv); p.y+=.018*sin(t*.42); p=hal_rotate(p,.035*sin(t*.28));
  float haze=hal_fog(p*5.0+vec2(t*.025,-t*.035));
  vec3 col=vec3(.005,.009,.012)+vec3(.025,.045,.060)*haze;
  float cranium=hal_ellipse(p-vec2(0.0,-.08),vec2(.255,.285));
  float cheek=hal_ellipse(vec2(abs(p.x)-.178,p.y-.075),vec2(.080,.105));
  float jaw=hal_ellipse(p-vec2(0.0,.215),vec2(.160,.120));
  float shape=min(cranium,min(cheek,jaw));
  float bone=hal_fill(shape);
  float texture=hal_fog(p*28.0)*.65+hal_grain(p)*.35;
  float volume=.39+.5*sqrt(max(0.0,1.0-pow(p.x/.27,2.0)));
  vec3 ivory=vec3(.63,.61,.45)*(volume*.79+texture*.21);
  float ridge=exp(-pow((abs(p.x)-.18)/.030,2.0))*exp(-pow((p.y-.08)/.12,2.0));
  ivory+=vec3(.20,.17,.11)*ridge;
  float sockets=0.0;
  for(int i=0;i<2;i++) {
    float side=float(i)*2.0-1.0;
    vec2 q=hal_rotate(p-vec2(side*.112,-.038),side*.16);
    float socket=hal_fill(hal_ellipse(q,vec2(.086,.087)));
    sockets=max(sockets,socket);
    float brow=exp(-pow(hal_line(p,vec2(side*.032,-.145),vec2(side*.204,-.109))/.011,2.0));
    ivory+=vec3(.19,.17,.10)*brow;
  }
  ivory=mix(ivory,vec3(.005,.007,.008),sockets);
  float nose=hal_triangle(p,vec2(-.039,.123),vec2(0.0,.020),vec2(.039,.123));
  ivory=mix(ivory,vec3(.016,.010,.008),nose);
  float mouth=hal_fill(hal_ellipse(p-vec2(0.0,.207),vec2(.125,.049)));
  ivory=mix(ivory,vec3(.012,.007,.004),mouth);
  for(int i=0;i<8;i++) {
    float x=(float(i)-3.5)*.027;
    float teeth=hal_fill(max(abs(p.x-x)-.010,abs(p.y-(.191+.02*pow(x/.12,2.0)))-.026));
    ivory=mix(ivory,vec3(.70,.64,.44)*(.7+.3*hal_hash(float(i))),teeth);
  }
  float crack=abs(p.x+.023+sin(p.y*27.0)*.010+sin(p.y*67.0)*.006);
  ivory*=1.0-.57*exp(-crack*950.0)*(1.0-smoothstep(-.12,-.06,p.y));
  col=mix(col,ivory,bone);
  float ember=.64+.20*sin(t*1.03);
  for(int i=0;i<2;i++) {
    vec2 q=p-vec2((float(i)*2.0-1.0)*.112,-.035);
    col+=vec3(.68,.008,.002)*exp(-dot(q,q)*780.0)*ember;
    col+=vec3(1.0,.24,.015)*exp(-dot(q,q)*13000.0)*ember;
  }
  return col;
}

float hal_ghost(vec2 q,float phase) {
  float upper=hal_ellipse(q-vec2(0.0,-.047),vec2(.086,.104));
  float hem=.15+.024*sin(q.x*74.0+phase);
  float lower=max(abs(q.x)-(.083-.022*smoothstep(0.0,.17,q.y)),max(-q.y-.05,q.y-hem));
  return hal_fill(min(upper,lower));
}
vec3 hal_spirits(vec2 uv,float t) {
  vec2 p=hal_scene(uv);
  float fog=hal_fog(p*4.2+vec2(t*.045,-t*.024));
  vec3 col=vec3(.008,.021,.021)+vec3(.03,.10,.11)*pow(fog,2.0);
  for(int i=0;i<6;i++) {
    float fi=float(i),seed=hal_hash(fi+48.0);
    vec2 center=vec2((fi-2.5)*.285+.065*sin(t*.29+fi*1.8),.22*sin(fi*3.1+t*.21));
    vec2 q=(p-center)/( .68+seed*.53); q.x+=.020*sin(q.y*19.0-t*.8+fi);
    float body=hal_ghost(q,t*.9+fi);
    float fold=.6+.4*sin(q.x*84.0+q.y*13.0-t*.4);
    vec3 spirit=vec3(.46,.73,.68)*(.62+.26*fold);
    float eyes=max(hal_fill(hal_ellipse(q-vec2(-.028,-.047),vec2(.015,.028))),hal_fill(hal_ellipse(q-vec2(.028,-.047),vec2(.015,.028))));
    float mouth=hal_fill(hal_ellipse(q-vec2(0.0,.013),vec2(.012,.024+.005*sin(t*.7+fi))));
    spirit=mix(spirit,vec3(.003,.019,.021),max(eyes,mouth));
    float fade=.62+.2*sin(t*.37+fi);
    col+=vec3(.024,.089,.077)*exp(-dot(q,q)*26.0);
    col=mix(col,spirit,body*fade);
  }
  return col;
}

float hal_spider(vec2 p,float t) {
  float insect=max(hal_fill(hal_ellipse(p,vec2(.025,.037))),hal_fill(hal_ellipse(p-vec2(0.0,-.036),vec2(.018,.019))));
  for(int i=0;i<4;i++) {
    float fi=float(i), y=-.031+fi*.017;
    for(int j=0;j<2;j++) {
      float side=float(j)*2.0-1.0;
      vec2 knee=vec2(side*(.060+.007*sin(t*2.0+fi)),y-.048+fi*.021);
      vec2 end=vec2(side*(.083+.008*sin(t*2.0+fi+.7)),y-.041+fi*.032);
      float d=min(hal_line(p,vec2(side*.014,y),knee),hal_line(p,knee,end));
      insect=max(insect,1.0-smoothstep(.0018,.004,d));
    }
  }
  return insect;
}
vec3 hal_web(vec2 uv,float t) {
  vec2 p=hal_scene(uv); float r=length(p),a=atan(p.y,p.x+.00001);
  float rays=abs(sin(a*10.0))*r/10.0;
  float warp=r+.008*sin(a*20.0)+.002*sin(t*.7+a*3.0);
  float rings=abs(fract(warp*12.0)-.5)/12.0;
  float web=max(exp(-rays*220.0)*.82,exp(-rings*420.0))*smoothstep(.035,.08,r)*(1.0-smoothstep(.55,.81,r));
  float fog=hal_fog(p*6.0+vec2(t*.018,0.0));
  vec3 col=vec3(.008,.012,.018)+vec3(.045,.057,.064)*fog;
  col+=vec3(.38,.46,.46)*web*(.65+.2*sin(a*3.0-t*.2));
  for(int i=0;i<3;i++) {
    float fi=float(i); vec2 center=vec2((fi-1.0)*.43,.10+.19*sin(t*.24+fi*2.1));
    vec2 q=hal_rotate(p-center,.1*sin(t*.5+fi));
    float thread=exp(-pow((p.x-center.x)/.0017,2.0))*(1.0-smoothstep(center.y-.07,center.y-.04,p.y));
    col+=vec3(.28,.34,.34)*thread;
    float bug=hal_spider(q,t+fi);
    col=mix(col,vec3(.015,.003,.004),bug);
    col+=vec3(.45,.017,.009)*exp(-dot(q-vec2(.005,-.005),q-vec2(.005,-.005))*5500.0);
    col+=vec3(.80,.07,.013)*exp(-dot(vec2(abs(q.x)-.007,q.y+.044),vec2(abs(q.x)-.007,q.y+.044))*90000.0);
  }
  return col;
}

float hal_bat(vec2 q,float t) {
  float x=abs(q.x),flap=.55+.45*sin(t);
  float top=-.023-sin(clamp(x/.12,0.0,1.0)*3.14159)*(.055*flap+.008);
  float bottom=.035-.010*x/.12-.022*abs(sin(x*78.0));
  float wing=hal_fill(max(x-.124,max(top-q.y,q.y-bottom)));
  float body=hal_fill(hal_ellipse(q,vec2(.016,.041)));
  float ears=hal_triangle(vec2(abs(q.x),q.y),vec2(.004,-.026),vec2(.012,-.060),vec2(.023,-.026));
  return max(wing,max(body,ears));
}
vec3 hal_moon(vec2 uv,float t) {
  vec2 p=hal_scene(uv); vec2 moon=p-vec2(.20,-.085);float radius=length(moon);
  float fog=hal_fog(p*5.0+vec2(t*.035,0.0));
  vec3 col=vec3(.014,.005,.016)+vec3(.19,.015,.013)*exp(-radius*3.0);
  float disk=hal_fill(radius-.295);
  float crater=hal_fog(moon*23.0)*.6+hal_noise(moon*53.0)*.4;
  col=mix(col,vec3(.84,.19,.055)*(.47+crater*.53),disk);
  col*=1.0-fog*.28;
  for(int i=0;i<9;i++) {
    float fi=float(i),seed=hal_hash(fi+22.0);
    vec2 center=vec2(fract(seed+t*(.016+seed*.018))*2.6-1.3,-.27+.46*hal_hash(fi+72.0)+.035*sin(t*.85+fi));
    vec2 q=hal_rotate(p-center,-.17+.18*sin(fi+t*.2))/( .30+seed*.58);
    col=mix(col,vec3(.004,.003,.008),hal_bat(q,t*3.6+fi*2.0));
  }
  float hills=.32+.036*sin(p.x*5.0)+.022*sin(p.x*13.0);
  col=mix(col,vec3(.006,.004,.009),smoothstep(hills-.004,hills+.004,p.y));
  return col;
}

vec3 hal_lantern(vec2 uv,float t) {
  vec2 p=hal_scene(uv);p.y+=.035;
  float r=length(p/vec2(.355,.316));
  float grooves=.5+.5*cos(asin(clamp(p.x/.355,-1.0,1.0))*13.0);
  float shape=hal_fill((r-1.0)*.3+.005*cos(p.x*37.0));
  float candle=.74+.11*sin(t*1.7)+.065*sin(t*2.73+1.3);
  vec3 col=vec3(.009,.003,.012)+vec3(.13,.028,.002)*exp(-length(p)*5.0);
  vec3 orange=vec3(.75,.19,.013)*(.31+.48*sqrt(max(0.0,1.0-p.x*p.x/.127))) *( .64+.36*grooves);
  orange+=vec3(.16,.058,.008)*hal_grain(p);
  float eyes=0.0;
  for(int i=0;i<2;i++) {
    float side=float(i)*2.0-1.0;vec2 q=vec2(p.x*side,p.y);
    eyes=max(eyes,hal_triangle(q,vec2(.037,-.066),vec2(.231,-.127),vec2(.188,.005)));
  }
  float nose=hal_triangle(p,vec2(-.035,.052),vec2(0.0,-.021),vec2(.035,.052));
  float upper=.093+.052*pow(p.x/.25,2.0);
  float lower=.197-.023*pow(p.x/.25,2.0);
  float mouth=hal_fill(max(abs(p.x)-.265,max(upper-p.y,p.y-lower)));
  float teeth=0.0;
  for(int i=0;i<7;i++) {
    float fi=float(i),x=(fi-3.0)*.065;float y=.104+.025*mod(fi,2.0);
    float tooth=hal_triangle(p,vec2(x-.020,y-.027),vec2(x+.019,y-.027),vec2(x+.003,y+.039));
    teeth=max(teeth,tooth);
  }
  mouth*=1.0-teeth;
  float cut=max(eyes,max(nose,mouth));
  float hot=.65+.35*hal_noise(p*12.0+vec2(0.0,t*.4));
  orange=mix(orange,vec3(1.0,.50,.044)*hot*candle,cut);
  col=mix(col,orange,shape);
  float stem=hal_fill(hal_ellipse(hal_rotate(p-vec2(.012,-.340),.23),vec2(.027,.062)));
  col=mix(col,vec3(.105,.11,.027)*( .55+.35*sin(p.x*260.0)),stem);
  return col;
}

vec3 hal_portal(vec2 uv,float t) {
  vec2 p=hal_scene(uv);float radius=length(p),a=atan(p.y,p.x+.00001);
  float curl=hal_fog(p*8.0+vec2(t*.045,-t*.07));
  float rim=.255+.019*sin(a*5.0+t*.38)+.012*sin(a*9.0-t*.56);
  float d=abs(radius-rim);
  float strands=.5+.5*sin(a*14.0-radius*34.0+t*1.45+curl*5.0);
  float fire=exp(-d*(39.0+24.0*curl));
  vec3 col=vec3(.014,.005,.023)+vec3(.18,.016,.25)*pow(curl,3.0)*exp(-radius*1.8);
  col+=mix(vec3(.41,.025,.91),vec3(1.0,.24,.034),strands)*fire*(.42+.53*strands);
  col+=vec3(.97,.62,.31)*exp(-d*180.0)*(.5+.32*sin(a*7.0-t*.8));
  float spiral=.5+.5*sin(a*3.0+radius*80.0+t*.72);
  col+=vec3(.17,.025,.23)*pow(spiral,12.0)*smoothstep(.05,.20,radius)*(1.0-smoothstep(.21,.25,radius));
  col*=.32+.68*smoothstep(.075,.19,radius);
  for(int i=0;i<12;i++) {
    float fi=float(i),angle=fi*.523599+t*.12,r=.34+.06*sin(t*.45+fi*1.9);
    vec2 q=p-vec2(cos(angle),sin(angle))*r;
    col+=vec3(.72,.15,.03)*exp(-dot(q,q)*16000.0)*(.45+.25*sin(t+fi));
  }
  return col;
}

vec3 hal_wound(vec2 uv,float t) {
  vec2 p=hal_scene(uv);p=hal_rotate(p,-.19);
  float flesh=hal_fog(p*16.0+vec2(.007*sin(t*.4),0.0));
  vec3 col=mix(vec3(.24,.14,.13),vec3(.52,.34,.27),flesh);
  col+=vec3(.040,.019,.011)*(hal_grain(p)-.5);
  float halfWidth=.050*pow(max(0.0,1.0-pow(p.x/.53,2.0)),.60);
  halfWidth*=.92+.08*sin(t*1.25);
  float center=.017*sin(p.x*13.0)+.006*sin(p.x*49.0);
  float torn=.006*(hal_noise(vec2(p.x*120.0,3.0))-.5);
  float d=max(abs(p.y-center)-halfWidth-torn,abs(p.x)-.53);
  float bruise=exp(-max(d,0.0)*21.0);
  col=mix(col,vec3(.28,.036,.042),bruise*.65);
  float rim=exp(-abs(d)*150.0);
  col=mix(col,vec3(.43,.014,.025),rim*.8);
  float cavity=hal_fill(d+.008);
  float muscle=.5+.5*sin(p.x*65.0+hal_noise(p*27.0)*4.0-t*.23);
  vec3 inside=vec3(.034,.0005,.006)+vec3(.21,.007,.017)*muscle*exp(-abs(p.y-center)*35.0);
  col=mix(col,inside,cavity);
  col+=vec3(.36,.09,.066)*exp(-pow((d-.007)/.0035,2.0))*(.45+.25*sin(p.x*39.0+t*.27));
  for(int i=0;i<7;i++) {
    float fi=float(i),x=(fi-3.0)*.123,seed=hal_hash(fi+8.0);
    float start=.04+.017*sin(x*13.0),end=start+.07+seed*.17+.018*sin(t*.32+fi);
    float drips=hal_fill(max(abs(p.x-x)-(.004+seed*.003),max(start-p.y,p.y-end)));
    drips=max(drips,hal_fill(hal_ellipse(p-vec2(x,end),vec2(.007,.012))));
    col=mix(col,vec3(.27,.005,.015),drips);
  }
  return col;
}

vec3 hal_swarm(vec2 uv,float t) {
  vec2 p=hal_scene(uv);float texture=hal_fog(p*8.0);
  vec3 col=mix(vec3(.10,.11,.056),vec3(.31,.28,.13),texture);
  col+=vec3(.03,.025,.008)*hal_grain(p);
  for(int i=0;i<36;i++) {
    float fi=float(i),seed=hal_hash(fi+28.0),heading=fi*2.39996;
    vec2 center=vec2(fract(hal_hash(fi+44.0)+t*(.013+seed*.017))*2.1-1.05,fract(hal_hash(fi+71.0)+t*(.009+seed*.01))*1.3-.65);
    center+=vec2(.025*sin(t*.8+fi),.013*cos(t*.7+fi));
    vec2 q=hal_rotate(p-center,heading+.24*sin(t*.6+fi))/(.65+seed*.70);
    float body=hal_fill(hal_ellipse(q,vec2(.022,.052)));
    float head=hal_fill(hal_ellipse(q-vec2(0.0,-.049),vec2(.015,.016)));
    float bug=max(body,head),legs=0.0;
    for(int j=0;j<3;j++) {
      float fj=float(j),y=(fj-1.0)*.024;
      vec2 mirror=vec2(abs(q.x),q.y);
      vec2 knee=vec2(.039,y-.012+.006*sin(t*5.0+fi+fj));
      float d=min(hal_line(mirror,vec2(.012,y),knee),hal_line(mirror,knee,vec2(.054,y+.017)));
      legs=max(legs,1.0-smoothstep(.001,.003,d));
    }
    bug=max(bug,legs);
    col=mix(col,vec3(.017,.009,.004),bug);
    float shell=exp(-pow(q.x/.013,2.0)-pow(q.y/.041,2.0));
    col+=vec3(.115,.039,.008)*shell;
    col*=1.0-.42*exp(-abs(q.x)*1900.0)*body;
  }
  return col;
}

vec3 hal_graveyard(vec2 uv,float t) {
  vec2 p=hal_scene(uv);float fog=hal_fog(p*5.0+vec2(t*.037,-t*.008));
  vec3 col=vec3(.015,.027,.041)+vec3(.066,.096,.081)*fog;
  vec2 moon=p-vec2(-.48,-.24);
  col+=vec3(.21,.28,.23)*hal_fill(length(moon)-.085)+vec3(.065,.10,.086)*exp(-length(moon)*8.0);
  for(int i=0;i<9;i++) {
    float fi=float(i),seed=hal_hash(fi+39.0),x=(fi-4.0)*.24;
    float base=.22+seed*.13; vec2 q=hal_rotate(p-vec2(x,base),.18*(seed-.5));
    float stone=hal_fill(max(abs(q.x)-(.038+seed*.017),max(-q.y-(.11+seed*.08),q.y)));
    float cap=hal_fill(hal_ellipse(q-vec2(0.0,-.11-seed*.08),vec2(.038+seed*.017,.027)));
    float cross=max(hal_fill(max(abs(q.x)-.009,abs(q.y+.11)-.075)),hal_fill(max(abs(q.x)-.043,abs(q.y+.13)-.009)));
    float tomb=mix(max(stone,cap),cross,step(.62,seed));
    col=mix(col,vec3(.012,.022,.023)+vec3(.025,.035,.030)*seed,tomb);
    float engrave=1.0-smoothstep(.001,.003,hal_line(q,vec2(-.015,-.083),vec2(.015,-.083)));
    col+=vec3(.034,.047,.039)*engrave*(1.0-step(.62,seed));
  }
  vec2 q=p-vec2(.22+.075*sin(t*.23),-.09+.044*sin(t*.37));
  q.x+=.012*sin(q.y*24.0-t*.65);q/=.78;
  float specter=hal_ghost(q,t*.6)*(.29+.17*sin(t*.38));
  float face=max(hal_fill(hal_ellipse(q-vec2(-.028,-.048),vec2(.013,.029))),hal_fill(hal_ellipse(q-vec2(.028,-.048),vec2(.013,.029))));
  col=mix(col,vec3(.20,.66,.44)*(1.0-face*.9),specter);
  float ground=smoothstep(.21,.5,p.y);
  float lowFog=hal_fog(vec2(p.x*4.0-t*.095,p.y*15.0+t*.025));
  col=mix(col,vec3(.06,.14,.12)*lowFog,ground*.86);
  return col;
}

vec3 halloweenPattern(int id,vec2 uv,float time) {
  if(id==37) return hal_eyes(uv,time);
  if(id==38) return hal_blood(uv,time);
  if(id==39) return hal_veins(uv,time);
  if(id==40) return hal_skull(uv,time);
  if(id==41) return hal_spirits(uv,time);
  if(id==42) return hal_web(uv,time);
  if(id==43) return hal_moon(uv,time);
  if(id==44) return hal_lantern(uv,time);
  if(id==45) return hal_portal(uv,time);
  if(id==46) return hal_wound(uv,time);
  if(id==47) return hal_swarm(uv,time);
  if(id==48) return hal_graveyard(uv,time);
  return vec3(0.0);
}
`;
