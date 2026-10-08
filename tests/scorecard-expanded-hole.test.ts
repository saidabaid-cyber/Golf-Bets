import assert from 'node:assert/strict';
import test from 'node:test';
import {socialUI,uiFind,uiNodes,uiText} from './helpers/social-ui';
import * as domain from '../lib/premium-scorecard';
import {qaCourse,qaOrder,qaPlayer,qaScores,qaPutts,qaAdvanced} from './fixtures/scorecard-ux';
import {completeScorecardQa} from '../lib/scorecard-qa-fixture';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PremiumScorecard} from '../app/components/premium-scorecard';
const props={roundId:'fixture',course:qaCourse,players:[qaPlayer],order:qaOrder,scores:qaScores,putts:qaPutts,advancedStats:qaAdvanced,view:{kind:'card'},onBack(){},onHole(){}};
test('18-hole view retains all real columns and OUT IN TOTAL; hole details are a single read-only panel, with full detail still accessible',()=>{let opened:any;const h=socialUI('app/components/premium-scorecard.tsx',{'premium-scorecard':domain});let tree=h.render('PremiumScorecard',{...props,onHole:(...values:any[])=>{opened=values;}});uiFind(tree,n=>n.type==='button'&&uiText(n).startsWith('18 HOYOS')).props.onClick();tree=h.render('PremiumScorecard',{...props,onHole:(...values:any[])=>{opened=values;}});assert.equal(uiNodes(tree).filter(n=>n.type==='th'&&n.props.scope==='col').length,22);uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Ver detalle del hoyo 4').props.onClick();tree=h.render('PremiumScorecard',{...props,onHole:(...values:any[])=>{opened=values;}});assert.equal(uiNodes(tree).filter(n=>n.props.className==='premiumInlineHole').length,1);assert.match(uiText(uiFind(tree,n=>n.props.className==='premiumInlineHole')),/Hoyo 4|Izquierda|Putts/);uiFind(tree,n=>n.type==='button'&&uiText(n)==='Ver detalle completo ›').props.onClick();assert.deepEqual(opened,[4,qaPlayer.id]);uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Ver detalle del hoyo 5').props.onClick();tree=h.render('PremiumScorecard',props);assert.match(uiText(uiFind(tree,n=>n.props.className==='premiumInlineHole')),/Hoyo 5|OB|Penalidades/);uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Cerrar detalles del hoyo').props.onClick();assert.equal(uiNodes(h.render('PremiumScorecard',props)).filter(n=>n.props.className==='premiumInlineHole').length,0);});
test('9-hole card never fabricates another nine and missing advanced data produces a compact panel',()=>{const h=socialUI('app/components/premium-scorecard.tsx',{'premium-scorecard':domain}),p={...props,order:qaOrder.slice(0,9),putts:undefined,advancedStats:undefined};let tree=h.render('PremiumScorecard',p);uiFind(tree,n=>n.type==='button'&&uiText(n).startsWith('9 HOYOS')).props.onClick();tree=h.render('PremiumScorecard',p);assert.equal(uiNodes(tree).filter(n=>n.type==='th'&&n.props.scope==='col').length,12);uiFind(tree,n=>n.type==='button'&&n.props['aria-label']==='Ver detalle del hoyo 1').props.onClick();tree=h.render('PremiumScorecard',p);const text=uiText(uiFind(tree,n=>n.props.className==='premiumInlineHole'));assert.doesNotMatch(text,/Putts|GIR|Penalidades|Sin datos|Capturar/);});
test('captured summary and dedicated detail retain direction, recorded zero and actual totals without enabling edits',()=>{
  const f=completeScorecardQa,p={...props,...f,players:[f.player],ownerId:f.player.id,accountUserId:f.player.accountUserId};
  const h=socialUI('app/components/premium-scorecard.tsx',{'premium-scorecard':domain});
  let tree=h.render('PremiumScorecard',p);
  assert.match(uiText(uiFind(tree,n=>n.props.className==='premiumCapturedSummary')),/Putts 32 GIR 11\/18 FIR 11\/14/);
  for(const [hole,expected]of [[5,'Derecha'],[6,'Centro'],[8,'Izquierda']]as const){
    tree=h.render('PremiumScorecard',{...p,view:{kind:'hole',hole,playerId:f.player.id}});
    const markup=renderToStaticMarkup(createElement(PremiumScorecard,{...p,view:{kind:'hole',hole,playerId:f.player.id}}));
    assert.match(markup,new RegExp(`data-selected="true">${expected}`));
    assert.doesNotMatch(uiText(tree),/Capturar este hoyo/);
  }
  tree=h.render('PremiumScorecard',{...p,view:{kind:'hole',hole:9,playerId:f.player.id}});
  assert.match(uiText(tree),/Putts 0/);assert.match(uiText(tree),/Primer putt 0 ft/);
  tree=h.render('PremiumScorecard',{...p,putts:undefined,advancedStats:undefined,view:{kind:'card'}});
  assert.equal(uiNodes(tree).some(n=>n.props.className==='premiumCapturedSummary'),false);
});
