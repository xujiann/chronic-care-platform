# 当地医保正式规则包导入模板

导入前请取得当地医保部门正式发布或批准的目录、权重/分值、费率/点值、机构系数和生效期文件。模板中的占位内容不具备结算效力，也不能通过正式发布校验。

## 文件清单

- `local-drg-package.template.json`：DRG正式规则包结构。
- `local-dip-package.template.json`：DIP正式规则包结构。
- `drg-catalog.template.csv`：DRG目录明细表头。
- `dip-catalog.template.csv`：DIP目录明细表头。
- `institution-coefficients.template.csv`：机构差异系数表头。

## 导入约束

1. JSON内的 `catalogCount` 必须与 `catalog` 实际条数一致。
2. 每个来源文件和批复文件均需计算SHA-256；正式发布前将 `verificationStatus` 标记为“已核验”。
3. 正式规则包的 `authority` 必须为 `local-medical-insurance-approved`；样例和联调数据保持 `template-only`。
4. DRG目录至少包含MDC、ADRG、DRG编码及权重；DIP目录至少包含病种编码、诊断匹配依据及分值。
5. 规则包不得包含姓名、身份证号、手机号等患者个人信息。
6. 导入后依次完成影响试算、业务复核、基金财务复核和发布冻结。

## Excel转换与规则包构建

使用LibreOffice把正式Excel中的目录工作表另存为UTF-8 CSV，再执行：

```powershell
npm.cmd run disease-payment:package -- build --base=config/disease-payment/templates/local-drg-package.template.json --catalog=<目录.csv> --coefficients=<机构系数.csv> --source=<医保原始文件.xlsx> --approval=<批复文件.pdf> --output=<规则包.json> --verified
```

构建工具会自动计算CSV、原始文件和批复文件SHA-256并填入规则包。`--verified` 代表操作者已人工确认来源，仅在正式文件核验完成后使用。
