package com.northflyers.vfr.dto;

import com.northflyers.vfr.domain.EndorsementKind;
import java.util.List;
import org.springframework.lang.Nullable;

/** One of the student endorsements (EndorsementKind): its code, AC
 *  61-65K's paragraph, the 14 CFR section, its name, the days it is good
 *  for, and the sample's words with the blanks the instructor fills. */
public record EndorsementKindDto(
        String code,
        String paragraph,
        String rule,
        String label,
        @Nullable Integer validDays,
        /** The sample's words, {student} and each field's {key} in them. */
        String template,
        List<EndorsementFieldDto> fields) {

    public static EndorsementKindDto of(EndorsementKind kind) {
        return new EndorsementKindDto(kind.code, kind.paragraph, kind.rule, kind.label, kind.validDays, kind.template,
                kind.fields.stream().map(f -> new EndorsementFieldDto(f.key, f.label, f.example, f.required)).toList());
    }
}
