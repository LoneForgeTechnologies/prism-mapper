/** Texture-free nature and atmosphere scenes; compatible with GLSL ES 1.00. */
export const organicGLSL = `
float organic_hash(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}

vec2 organic_hash2(vec2 p) {
  return vec2(organic_hash(p),organic_hash(p+vec2(17.17,43.71)));
}

float organic_noise(vec2 p) {
  vec2 cell=floor(p), f=fract(p);
  vec2 w=f*f*(3.0-2.0*f);
  return mix(mix(organic_hash(cell),organic_hash(cell+vec2(1,0)),w.x),
             mix(organic_hash(cell+vec2(0,1)),organic_hash(cell+vec2(1,1)),w.x),w.y);
}

float organic_fbm(vec2 p) {
  float result=0.0, amplitude=.5333;
  for(int i=0;i<4;i++) {
    result+=amplitude*organic_noise(p);
    p=mat2(.80,.60,-.60,.80)*p*2.03+vec2(13.2,7.1);
    amplitude*=.5;
  }
  return result;
}

vec3 organic_ocean(vec2 uv, float time) {
  vec2 p=uv*vec2(10.0,6.0);
  p+=vec2(sin(p.y*.85+time*.28),cos(p.x*.61-time*.21))*.48;
  p+=vec2(sin(p.y*2.2-p.x*.5+time*.31),sin(p.x*2.0+p.y*.7-time*.27))*.23;
  vec2 cell=floor(p), f=fract(p);
  float nearest=10.0, second=10.0;
  for(int y=-1;y<=1;y++) {
    for(int x=-1;x<=1;x++) {
      vec2 offset=vec2(float(x),float(y));
      vec2 seed=organic_hash2(cell+offset);
      vec2 point=.5+.34*sin(seed*6.283185+time*.34+vec2(0.0,1.7));
      vec2 delta=offset+point-f;
      float distanceSquared=dot(delta,delta);
      if(distanceSquared<nearest) { second=nearest; nearest=distanceSquared; }
      else second=min(second,distanceSquared);
    }
  }
  float seam=max(0.0,sqrt(second)-sqrt(nearest));
  float caustic=exp(-seam*27.0);
  float halo=exp(-seam*7.5);
  float swell=.5+.5*sin(p.x*.66+p.y*.73+time*.23);
  float depth=clamp(.28+.5*uv.y+.17*swell,0.0,1.0);
  vec3 color=mix(vec3(.013,.19,.24),vec3(.006,.042,.16),depth);
  color+=vec3(.09,.40,.48)*halo*.44;
  color+=vec3(.36,.94,.84)*caustic*(.48+.19*swell);
  color+=vec3(.025,.13,.20)*pow(.5+.5*sin(p.x*1.5-p.y+time*.35),5.0);
  return color;
}

vec3 organic_flame(vec2 uv, float time) {
  float height=1.0-uv.y;
  vec2 p=uv*vec2(5.5,4.5)+vec2(0.0,time*.60);
  float warp=organic_fbm(p*.67+vec2(time*.045,0));
  float turbulence=organic_fbm(p+vec2((warp-.5)*2.7,0));
  float tongues=.71-height+(turbulence-.48)*.88;
  float fire=smoothstep(-.075,.11,tongues);
  float core=smoothstep(.12,.64,tongues);
  vec3 fireColor=mix(vec3(.86,.075,.006),vec3(1.0,.43,.025),smoothstep(-.015,.23,tongues));
  fireColor=mix(fireColor,vec3(1.0,.89,.38),core);
  vec3 color=vec3(.026,.005,.012)+fireColor*fire;
  color+=vec3(.33,.035,.002)*exp(-abs(tongues)*9.0)*.5;
  for(int i=0;i<8;i++) {
    float seed=float(i)+1.0;
    float y=fract(organic_hash(vec2(seed,9.0))-time*(.033+.022*organic_hash(vec2(seed,1.0))));
    float x=organic_hash(vec2(seed,5.0))+.034*sin(time*.54+seed+y*4.0);
    vec2 delta=(uv-vec2(x,y))*vec2(1.7778,1.0);
    float spark=exp(-dot(delta,delta)*80000.0);
    color+=vec3(1.0,.38,.06)*spark*(1.0-fire*.7)*smoothstep(0.0,.16,y);
  }
  return color;
}

vec3 organic_clouds(vec2 uv, float time) {
  vec2 p=uv*vec2(4.5,3.1)+vec2(time*.037,0.0);
  float cloud=organic_fbm(p);
  float detail=organic_fbm(p*1.85+vec2(2.8,time*.013));
  float mass=smoothstep(.37,.70,cloud*.8+detail*.2);
  float shade=smoothstep(.38,.66,detail);
  vec3 sky=mix(vec3(.045,.16,.39),vec3(.31,.61,.72),clamp(uv.y,0.0,1.0));
  vec2 sunDelta=(uv-vec2(.77,.22))*vec2(1.7778,1.0);
  sky+=vec3(.56,.36,.17)*exp(-dot(sunDelta,sunDelta)*6.5)*.62;
  vec3 cloudColor=mix(vec3(.26,.40,.61),vec3(.95,.92,.79),shade*.63+.29);
  vec3 color=mix(sky,cloudColor,mass);
  float silver=exp(-pow(cloud*.8+detail*.2-.45,2.0)*900.0);
  color+=vec3(.24,.23,.18)*silver*exp(-dot(sunDelta,sunDelta)*2.0);
  return color;
}

vec3 organic_lava(vec2 uv, float time) {
  vec2 p=(uv-.5)*vec2(1.7778,1.0);
  float field=0.0, colorWeight=0.0;
  for(int i=0;i<8;i++) {
    float seed=float(i);
    vec2 center=vec2(.62*sin(seed*2.399+time*(.11+.008*seed)),
                     .48*sin(seed*1.79-time*(.15+.004*seed)));
    float radius=.09+.027*sin(seed*1.9+2.0);
    vec2 d=p-center;
    float blob=radius*radius/(dot(d,d)+.0016);
    field+=blob;
    colorWeight+=blob*(.5+.5*sin(seed*2.17+time*.07));
  }
  float inside=smoothstep(.82,1.06,field);
  float rim=exp(-pow(field-.99,2.0)*13.0);
  float heat=colorWeight/max(field,.001);
  vec3 ink=vec3(.018,.006,.07)+vec3(.09,.015,.10)*min(field,.8);
  vec3 molten=mix(vec3(.82,.055,.27),vec3(1.0,.47,.055),heat);
  molten+=vec3(.12,.16,.12)*smoothstep(1.25,3.0,field);
  return mix(ink,molten,inside)+vec3(.34,.085,.20)*rim*.52;
}

vec3 organic_galaxy(vec2 uv, float time) {
  vec2 p=(uv-.5)*vec2(1.7778,1.0);
  float angle=time*.018;
  p=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
  float radius=length(p);
  float theta=atan(p.y,p.x);
  float spiral=.5+.5*sin(theta*2.0-radius*10.0+time*.045);
  float dust=organic_fbm(p*4.2+vec2(time*.012,0));
  float fine=organic_fbm(p*10.0+vec2(3.0,-time*.012));
  float arms=pow(spiral,2.0)*exp(-radius*2.1)*smoothstep(.19,.73,dust);
  vec3 color=vec3(.007,.008,.032);
  color+=mix(vec3(.11,.08,.58),vec3(.72,.10,.40),dust)*(arms*.95+fine*.08);
  color+=vec3(.07,.47,.60)*arms*smoothstep(.36,.70,fine)*.75;
  color+=vec3(1.0,.66,.34)*exp(-radius*radius*65.0)*.73;
  vec2 starP=(uv+vec2(time*.0015,-time*.0007))*vec2(48.0,27.0);
  vec2 cell=floor(starP), f=fract(starP);
  for(int y=-1;y<=1;y++) {
    for(int x=-1;x<=1;x++) {
      vec2 offset=vec2(float(x),float(y));
      vec2 seed=organic_hash2(cell+offset);
      vec2 delta=offset+.12+.76*seed-f;
      float present=step(.83,organic_hash(cell+offset+31.0));
      float star=exp(-dot(delta,delta)*(650.0-400.0*seed.x));
      float twinkle=.72+.28*sin(time*.67+seed.y*6.283185);
      color+=mix(vec3(.44,.66,1.0),vec3(1.0,.89,.65),seed.x)*star*present*twinkle;
    }
  }
  return color;
}

float organic_rainLayer(vec2 uv, float time, float layer) {
  vec2 p=uv*vec2(40.0,11.0)*(1.0+layer*.46);
  p.x+=p.y*.47;
  float column=floor(p.x);
  float seed=organic_hash(vec2(column,layer+4.0));
  p.y-=time*(2.2+seed*1.8+layer*.6);
  p.y+=seed*11.0;
  vec2 f=fract(p);
  float center=.2+.6*organic_hash(vec2(column,layer+17.0));
  float width=.016+layer*.008;
  float line=exp(-pow((f.x-center)/width,2.0));
  float tail=smoothstep(.02,.57,f.y)*(1.0-smoothstep(.68,.79,f.y));
  float active=step(.22,organic_hash(vec2(column,floor(p.y)+layer*81.0)));
  return line*tail*active;
}

vec3 organic_rain(vec2 uv, float time) {
  vec3 color=mix(vec3(.012,.035,.074),vec3(.052,.105,.16),clamp(uv.y,0.0,1.0));
  float light=exp(-pow((uv.x-.65)*2.5,2.0));
  color+=vec3(.07,.12,.14)*light*.5;
  float rain=0.0;
  for(int i=0;i<3;i++) {
    rain+=organic_rainLayer(uv+float(i)*vec2(.127,.37),time,float(i))*(.58-.13*float(i));
  }
  color+=vec3(.45,.70,.91)*rain;
  float ground=smoothstep(.73,1.0,uv.y);
  float ripple=pow(.5+.5*sin(uv.y*155.0+sin(uv.x*18.0+time*.6)*2.0-time*1.8),12.0);
  color+=vec3(.09,.23,.29)*ripple*ground*light;
  return color;
}

float organic_snowLayer(vec2 uv, float time, float depth) {
  vec2 p=uv*vec2(24.0,13.5)/depth;
  p.y-=time*(.38+depth*.26);
  p.x+=time*.09+.12*sin(time*.37+depth);
  vec2 cell=floor(p), f=fract(p);
  float flakes=0.0;
  for(int y=-1;y<=1;y++) {
    for(int x=-1;x<=1;x++) {
      vec2 offset=vec2(float(x),float(y));
      vec2 seed=organic_hash2(cell+offset+depth*31.0);
      vec2 center=.2+.6*seed;
      center.x+=.15*sin(time*.65+seed.x*6.283185);
      vec2 delta=offset+center-f;
      float size=.022+.027*seed.y;
      float flake=exp(-dot(delta,delta)/(size*size));
      float halo=exp(-dot(delta,delta)/(size*size*6.0))*.11;
      flakes+=(flake+halo)*(.45+.55*seed.x);
    }
  }
  return flakes;
}

vec3 organic_snow(vec2 uv, float time) {
  float glow=exp(-dot((uv-vec2(.68,.22))*vec2(1.4,1.0),(uv-vec2(.68,.22))*vec2(1.4,1.0))*3.5);
  vec3 color=vec3(.018,.027,.095)+vec3(.095,.14,.23)*glow;
  color+=vec3(.29,.49,.78)*organic_snowLayer(uv,time,1.0)*.55;
  color+=vec3(.84,.92,1.0)*organic_snowLayer(uv+vec2(.15,.31),time,1.85);
  return color;
}

vec3 organic_fireflies(vec2 uv, float time) {
  float fog=organic_fbm(uv*vec2(4.0,2.0)+vec2(time*.012,0.0));
  vec3 color=vec3(.004,.024,.035)+vec3(.018,.10,.095)*fog*.6;
  float grass=.91+.045*sin(uv.x*40.0)+.026*sin(uv.x*113.0);
  color*=1.0-.64*smoothstep(grass-.05,grass+.03,uv.y);
  for(int i=0;i<20;i++) {
    float seed=float(i)+1.0;
    vec2 base=organic_hash2(vec2(seed,19.0));
    vec2 center=vec2(.06+.88*base.x,.13+.68*base.y);
    center+=vec2(.055*sin(time*(.19+.12*base.y)+seed*2.1),
                  .055*cos(time*(.16+.10*base.x)+seed*1.7));
    vec2 delta=(uv-center)*vec2(1.7778,1.0);
    float size=.0025+.0037*base.y;
    float core=exp(-dot(delta,delta)/(size*size));
    float glow=exp(-dot(delta,delta)/(size*size*30.0));
    float breath=.67+.33*sin(time*(.45+.22*base.x)+seed*2.4);
    color+=vec3(.93,1.0,.29)*core*breath;
    color+=vec3(.29,.60,.065)*glow*.32*breath;
  }
  return color;
}

vec3 organicPattern(int id, vec2 uv, float time) {
  if(id==5) return organic_ocean(uv,time);
  if(id==6) return organic_flame(uv,time);
  if(id==7) return organic_clouds(uv,time);
  if(id==8) return organic_lava(uv,time);
  if(id==9) return organic_galaxy(uv,time);
  if(id==10) return organic_rain(uv,time);
  if(id==11) return organic_snow(uv,time);
  if(id==12) return organic_fireflies(uv,time);
  return vec3(0.0);
}
`;
