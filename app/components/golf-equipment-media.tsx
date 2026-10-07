import Image from "next/image";
import type { SocialActivityCard } from "../../lib/social-activity-contract";
import styles from "./golf-equipment-media.module.css";
type Item = NonNullable<SocialActivityCard["equipment"]>["items"][number];
const categoryAssets: Record<string,string> = {
  Driver:"driver", "Mini driver":"driver", Maderas:"fairway", "Madera de fairway":"fairway", Híbridos:"hybrid", Híbrido:"hybrid", Hierros:"irons", "Hierro utility":"irons", Wedges:"wedge", Wedge:"wedge", Putter:"putter", Bola:"ball",
};
export function equipmentMediaSource(item: Item) {
  return item.imageUrl || (categoryAssets[item.category]?`/brand/equipment/backyard-${categoryAssets[item.category]}-clean.png`:null);
}
/** Category cutouts are explicitly references, never claimed photographs of a specific model. */
export function GolfEquipmentMedia({item,large=false}:{item:Item;large?:boolean}) {
  const src=equipmentMediaSource(item);
  return <span className={`${styles.media} ${large?styles.large:""}`} data-equipment-media={item.imageUrl?"product":"category"}>
    {src?<Image src={src} alt={item.imageUrl?`${item.brand} ${item.model}`:`Referencia de categoría: ${item.category}`} width={large?280:72} height={large?280:72} sizes={large?"280px":"72px"}/>:<span className={styles.placeholder} aria-label={`Sin fotografía de ${item.category}`}>{item.category.slice(0,1)}</span>}
    {large&&!item.imageUrl&&<small>Referencia de categoría</small>}
  </span>;
}
