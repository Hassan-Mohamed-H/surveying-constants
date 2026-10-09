import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

/**
 * تحويل القيمة إلى رقم
 */
function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(
        String(value)
            .replace(/,/g, "")
            .trim()
    );

    return Number.isFinite(number) ? number : null;
}

/**
 * تحويل القيمة إلى نص
 */
function toText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

/**
 * تجهيز بيانات الثوابت المساحية
 *
 * الأعمدة:
 * Name
 * Code
 * Northing
 * Easting
 * Elevation
 * Description
 * Type
 * Status
 * CRS
 */
function normalizeRows(rawRows) {
    return rawRows
        .map((row) => {
            return {
                name: toText(row.Name),
                code: toText(row.Code),

                northing: toNumber(row.Northing),
                easting: toNumber(row.Easting),
                elevation: toNumber(row.Elevation),

                description: toText(row.Description),
                type: toText(row.Type),
                status: toText(row.Status),

                // نظام الإحداثيات الخاص بالنقطة
                crs: toText(row.CRS)
            };
        })
        .filter((point) => {
            // لازم يكون عندنا Northing و Easting و CRS
            return (
                point.northing !== null &&
                point.easting !== null &&
                point.crs !== ""
            );
        });
}


/**
 * تحميل بيانات Google Sheets
 */
export async function loadGoogleSheetData(url) {
    if (!url) {
        throw new Error("رابط Google Sheet غير موجود.");
    }

    try {
        const sheetUrl = new URL(
            url,
            window.location.href
        );

        // منع استخدام نسخة قديمة من البيانات
        sheetUrl.searchParams.set(
            "_ts",
            Date.now()
        );

        const response = await fetch(
            sheetUrl.toString(),
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `فشل تحميل Google Sheet: ${response.status} ${response.statusText}`
            );
        }

        const csvText = await response.text();

        if (!csvText.trim()) {
            throw new Error("Google Sheet فارغ.");
        }

        // قراءة CSV باستخدام SheetJS
        const workbook = XLSX.read(
            csvText,
            {
                type: "string",
                raw: false
            }
        );

        const firstSheetName =
            workbook.SheetNames[0];

        if (!firstSheetName) {
            throw new Error(
                "لم يتم العثور على ورقة داخل Google Sheet."
            );
        }

        const worksheet =
            workbook.Sheets[firstSheetName];

        const rawRows =
            XLSX.utils.sheet_to_json(
                worksheet,
                {
                    defval: "",
                    raw: false
                }
            );

        if (!rawRows.length) {
            throw new Error(
                "لا توجد بيانات في Google Sheet."
            );
        }

        const normalizedData =
            normalizeRows(rawRows);

        if (!normalizedData.length) {
            throw new Error(
                "لم يتم العثور على نقاط مساحية صحيحة. تأكد من وجود Northing و Easting و CRS."
            );
        }

        console.log(
            `تم تحميل ${normalizedData.length} نقطة مساحية من Google Sheet`
        );

        return normalizedData;

    } catch (error) {
        console.error(
            "خطأ في تحميل بيانات Google Sheet:",
            error
        );

        throw error;
    }
}


/**
 * تحميل Excel
 *
 * موجودة للتوافق مع أي جزء قديم من المشروع.
 */
export async function loadExcelData(url) {
    if (!url) {
        throw new Error(
            "رابط ملف Excel غير موجود."
        );
    }

    try {
        const response = await fetch(
            url,
            {
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `فشل تحميل ملف Excel: ${response.status} ${response.statusText}`
            );
        }

        const arrayBuffer =
            await response.arrayBuffer();

        const workbook = XLSX.read(
            arrayBuffer,
            {
                type: "array",
                raw: false
            }
        );

        const firstSheetName =
            workbook.SheetNames[0];

        if (!firstSheetName) {
            throw new Error(
                "لم يتم العثور على ورقة داخل ملف Excel."
            );
        }

        const worksheet =
            workbook.Sheets[firstSheetName];

        const rawRows =
            XLSX.utils.sheet_to_json(
                worksheet,
                {
                    defval: "",
                    raw: false
                }
            );

        return normalizeRows(rawRows);

    } catch (error) {
        console.error(
            "خطأ في تحميل ملف Excel:",
            error
        );

        throw error;
    }
}