import '@angular/compiler';
import { parseEntity } from '../src/app/models/entity/parse-entity';
import { buildEquipmentRegistry } from '../src/app/services/catalogs/equipment-catalog-builder';
import { calculateBattleValueDetails } from '../src/app/models/entity/utils/battle-value';
import { RecordSheetSvgGenerator } from '../src/app/utils/sheets/record-sheet-svg-generator';
import { recordSheetLayoutProfile, resolveRecordSheetLayout } from '../src/app/utils/sheets/layouts/record-sheet-layout-resolver';
import { buildMekRuntimeIndex } from '../src/app/models/runtime/mek-runtime-index';
import { createMekRuntimeBinding, queryMekRuntime } from '../src/app/models/runtime/unit-instance';
import { createMekMechanicsContextV2, mekMechanicsContextCapabilityV2 } from '../src/app/models/runtime/mek-mechanics-context-v2';
import { createMekHeatContextV2 } from '../src/app/models/runtime/mek-heat-state-v2';
import { initializeUnitState } from '../src/app/models/runtime/unit-state-initializer';
import { projectMekRecordSheet } from '../src/app/models/runtime/mek-record-sheet';
import { projectNonMekRecordSheet } from '../src/app/models/runtime/non-mek-record-sheet';
import { createNonMekRuntimeBinding } from '../src/app/models/runtime/non-mek-unit-instance';
import { MM_DATA_MEK_SHEET_BINDING_MANIFEST } from '../src/app/models/mek-sheet-binding';
import { bindMekRecordSheet } from '../src/app/components/page-viewer/mek-record-sheet-binder';
import { bindNonMekRecordSheet } from '../src/app/components/page-viewer/non-mek-record-sheet-binder';
import { CBTPrintUtil } from '../src/app/utils/cbtprint.util';

let registry: ReturnType<typeof buildEquipmentRegistry>;
let quirkMap: Map<string, any>;
let bookMap: Map<string, any>;
const w = window as any;
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const round = (n: number) => Math.round(n * 100) / 100;

function inspect(svg: SVGSVGElement) {
    const host = document.createElement('div');
    host.style.cssText = 'position:relative;width:612px;background:white';
    host.append(svg); document.body.append(host);
    const rootBox = svg.getBoundingClientRect();
    const nodes:Text[]=[];
    const walker=document.createTreeWalker(svg,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()){
        if(node.parentElement?.closest('text')&&norm(node.textContent))nodes.push(node as Text);
    }
    // MML often stores an entire table in one <text> with positioned <tspan>s.
    // Read actual text nodes, rather than treating that whole table as one value.
    const all = nodes.map(node => {
        const el=node.parentElement! as unknown as SVGGraphicsElement;
        const parents = []; let p: Element | null = el;
        let hidden = false;
        while(p && p !== svg) {
            const style = getComputedStyle(p);
            if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0) hidden = true;
            if(p.id) parents.push(p.id);
            p = p.parentElement;
        }
        const range=document.createRange();range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const box = { x: round(rect.x-rootBox.x), y: round(rect.y-rootBox.y), width: round(rect.width), height: round(rect.height) };
        const outside = rect.right < rootBox.left || rect.left > rootBox.right || rect.bottom < rootBox.top || rect.top > rootBox.bottom;
        return { text: norm(node.textContent), id:el.id, class:el.getAttribute('class'), parents:parents.slice(0,7),
            box, font:getComputedStyle(el).fontSize, visible:!hidden && rect.width>0 && rect.height>0 && !outside,
            hidden, outside, clip:el.closest('[clip-path]')?.getAttribute('clip-path') ?? null };
    }).filter(t=>t.text);
    const pips: Record<string,number> = {};
    const visiblePips: Record<string,number> = {};
    for(const el of svg.querySelectorAll('.pip')) {
        const key = `${el.getAttribute('class')}|${el.getAttribute('data-loc')}|${el.getAttribute('data-rear')}`;
        pips[key] = (pips[key]??0)+1;
        const rect = el.getBoundingClientRect();
        let hidden = rect.width === 0 || rect.height === 0;
        for(let parent: Element | null = el; parent && parent !== svg; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            hidden ||= style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0;
        }
        if (!hidden && rect.right >= rootBox.left && rect.left <= rootBox.right
            && rect.bottom >= rootBox.top && rect.top <= rootBox.bottom) {
            visiblePips[key] = (visiblePips[key]??0)+1;
        }
    }
    const groups = [...svg.querySelectorAll('g[id]')].map(g=>({id:g.id,text:norm(g.textContent)})).filter(g=>g.text);
    const result = {width:round(rootBox.width),height:round(rootBox.height),viewBox:svg.getAttribute('viewBox'),
        layout:svg.getAttribute('data-mekbay-layout'),pageIndex:svg.getAttribute('data-mekbay-page-index'),
        text:all,groups,pips,visiblePips,geometry:{paths:svg.querySelectorAll('path').length,circles:svg.querySelectorAll('circle').length,
            ellipses:svg.querySelectorAll('ellipse').length,rects:svg.querySelectorAll('rect').length,images:svg.querySelectorAll('image').length},
        duplicateIds:[...svg.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,a)=>a.indexOf(id)!==i)};
    host.remove(); return result;
}
w.sheetAuditInitialize = async (equipment:any, quirks:any, books:any) => {
    registry=buildEquipmentRegistry(equipment);
    quirkMap=new Map(quirks.quirks.map((q:any)=>[q.key,q])); bookMap=new Map(books.map((b:any)=>[b.abbrev,b]));
    const font=new FontFace('Roboto', 'url(/fonts/Roboto-VariableFont_wdth,wght.ttf)');
    document.fonts.add(await font.load());
    const condensed=new FontFace('Roboto Condensed','url(/fonts/RobotoCondensed-VariableFont_wght.ttf)');
    document.fonts.add(await condensed.load()); await document.fonts.ready;
};
w.sheetAuditReference = (text:string) => {
    const svg = new DOMParser().parseFromString(text,'image/svg+xml').documentElement as unknown as SVGSVGElement;
    return inspect(document.importNode(svg,true));
};
w.sheetAuditClassifyBatch = (inputs:any[]) => inputs.map(input=>{
    try {
        const {entity,diagnostics}=parseEntity(input.text,input.file,registry,{quirkResolver:k=>quirkMap.get(k),sourcebookResolver:k=>bookMap.get(k)});
        const equipment=entity.equipment();
        return {file:input.file,entityType:entity.entityType,name:entity.displayName(),layout:resolveRecordSheetLayout(entity).id,
            profile:recordSheetLayoutProfile(entity,'letter'),chassis:(entity as any).chassisConfig??null,movement:entity.motiveType(),tonnage:entity.tonnage(),
            equipmentCount:equipment.length,weaponCount:equipment.filter(m=>m.equipment?.type==='weapon').length,
            conditionalEquipment:[...new Set(equipment.flatMap(m=>['F_MISSILE','F_CLUSTERHIT','F_ARTEMIS','F_ARTEMIS_V','F_DETACHABLE_WEAPON_PACK','F_FIELD_KITCHEN','F_MASC','F_TSM','F_SCM','F_MECHANICAL_JUMP_BOOSTER','F_PARTIAL_WING','F_SHIELD'].filter(f=>m.equipment?.hasFlag(f as any))))],diagnostics};
    }catch(error){return {file:input.file,error:String(error)};}
});
w.sheetAuditGenerate = async (nativeText:string, file:string, ruleset:any) => {
    const {entity,diagnostics}=parseEntity(nativeText,file,registry,{quirkResolver:k=>quirkMap.get(k),sourcebookResolver:k=>bookMap.get(k)});
    const profile=recordSheetLayoutProfile(entity,'letter');
    const pages=await RecordSheetSvgGenerator.generatePages(entity,{format:profile.compact?'compact':'letter',pageFormat:'letter',ruleset,showQuirks:true,fluffImageUrl:null});
    const raw=pages.map(svg=>inspect(svg));
    const bv=calculateBattleValueDetails(entity,undefined,ruleset).base;
    let snapshot:any, bindingError:string|null=null;
    try {
        if(entity.entityType==='Mek') {
            const mek=entity as any; const index=buildMekRuntimeIndex(mek);
            const scenario={id:'megamek',options:{forcedWithdrawal:true,sprinting:false,hotLoadedAmmo:false}};
            const init=initializeUnitState(mek,index,entity.uuid(),{initializerRevision:1,profileId:'pristine',deployment:{id:'default'},scenario:{...scenario,ruleset}});
            const heat=createMekHeatContextV2(mek,index,ruleset,scenario);
            const mechanics=createMekMechanicsContextV2(mek,index,ruleset,scenario);
            if(mechanics.kind!=='supported') throw new Error(JSON.stringify(mekMechanicsContextCapabilityV2(mechanics)));
            const prepared=createMekRuntimeBinding(mek,index,ruleset,init.state,init.deployment.crewAssignment,heat,mechanics);
            snapshot={...projectMekRecordSheet(mek,index,ruleset,prepared.state,queryMekRuntime(prepared.binding,prepared.state),
                {revision:0,targets:[]},{pristine:bv,current:bv,adjusted:bv}),'editContext':{owner:{},state:prepared.state}};
            for(const svg of pages){const binding=bindMekRecordSheet(svg,MM_DATA_MEK_SHEET_BINDING_MANIFEST,snapshot);binding.render(snapshot);binding.destroy();}
        } else {
            const prepared=createNonMekRuntimeBinding(entity,ruleset);
            snapshot={...projectNonMekRecordSheet(entity,prepared.binding.index,prepared.state,ruleset,bv,bv,prepared.binding.crewAssignment),editContext:{owner:{},state:prepared.state}};
            for(const svg of pages){const binding=bindNonMekRecordSheet(svg,snapshot);binding.render(snapshot);binding.destroy();}
        }
    } catch(e) { bindingError=e instanceof Error ? e.stack ?? String(e) : String(e); }
    // Print with reference tables visible, no fluff; no live damage or user naming overrides.
    for(const svg of pages){
        svg.querySelectorAll<SVGElement>('.referenceTable').forEach(e=>e.style.display='block');
        svg.querySelectorAll<SVGElement>('#fluffImage,#fluff-image-fo,#fluff-image-injected').forEach(e=>e.style.display='none');
    }
    const screen=pages.map(svg=>inspect(svg));
    for(const svg of pages){
        (CBTPrintUtil as any).applyPilotDataPrintOption(svg,false,bv);
        svg.classList.add('print-preview');
    }
    const printPages=profile.compact?[RecordSheetSvgGenerator.composeCompactPage(pages,'letter')]:pages;
    for(const svg of printPages)svg.classList.add('print-preview');
    return {entityType:entity.entityType,name:entity.displayName(),ruleset,diagnostics,bindingError,
        facts:{bv,nativeBv:entity.battleValue(),tonnage:entity.tonnage(),walk:entity.walkMP(),run:entity.runMP(),jump:entity.jumpMP(),equipment:entity.equipment().map(m=>({id:m.equipmentId,mountId:m.mountId,location:m.location,name:m.equipment?.name,size:m.size,shots:m.getAmmoShots()}))},
        raw,screen,compactComposition:profile.compact,pages:printPages.map(svg=>inspect(svg)),svgs:printPages.map(svg=>new XMLSerializer().serializeToString(svg))};
};
